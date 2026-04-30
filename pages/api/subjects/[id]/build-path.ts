import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

// Pass 1: per-file decomposition
const PerFileSchema = z.object({
  stages: z.array(z.object({
    name: z.string(),
    key_concepts: z.array(z.string()),
    prerequisite_knowledge: z.array(z.string()),
  })),
})

// File ordering fallback (when no lecture numbers in filenames)
const FileOrderSchema = z.object({
  ordered_file_names: z.array(z.string()),
})

// Pedagogical stage ordering pass
const StageOrderSchema = z.object({
  ordered_stage_ids: z.array(z.string()),
})

// Pass 2: enrich only — topics + material details, NO ordering
const EnrichSchema = z.object({
  topics: z.array(z.object({
    name: z.string(),
    description: z.string(),
    weight: z.number().min(0).max(1),
    source_files: z.array(z.string()),
  })),
  stages: z.array(z.object({
    name: z.string(),
    topic_names: z.array(z.string()),
    estimated_minutes: z.number().int().min(10).max(120),
    material_types: z.array(z.enum(['summary', 'flashcards', 'concept_map'])),
    test_types: z.array(z.enum(['recall', 'mcq'])),
    source_files: z.array(z.string()),
  })),
})

interface PerFileResult {
  file_name: string
  lecture_num: number | null
  stages: Array<{ name: string; key_concepts: string[]; prerequisite_knowledge: string[] }>
}

interface DedupedStage {
  name: string
  key_concepts: string[]
  prerequisite_knowledge: string[]
  source_files: string[]
}

// Jaccard similarity on content words (>= 4 chars, not stop words)
function jaccardSimilarity(a: string, b: string): number {
  const stopWords = new Set([
    'introduction', 'understanding', 'exploring', 'analyzing', 'overview',
    'fundamentals', 'basics', 'principles', 'concepts', 'theory', 'theories',
    'with', 'from', 'into', 'this', 'that', 'their', 'between', 'role',
    'implications', 'challenges',
  ])
  const normalize = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
      .filter(w => w.length >= 4 && !stopWords.has(w))
  )
  const wa = normalize(a)
  const wb = normalize(b)
  if (wa.size === 0 && wb.size === 0) return 1
  if (wa.size === 0 || wb.size === 0) return 0
  const intersection = [...wa].filter(w => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return intersection / union
}

// Two stages are considered duplicates if their names match closely OR if their key_concepts
// overlap significantly (catches same concept with different names across files).
function stagesOverlap(
  existing: DedupedStage,
  incoming: { name: string; key_concepts: string[] }
): boolean {
  if (jaccardSimilarity(existing.name, incoming.name) >= 0.6) return true
  const setA = new Set(existing.key_concepts.map(c => c.toLowerCase()))
  const setB = new Set(incoming.key_concepts.map(c => c.toLowerCase()))
  if (setA.size === 0 || setB.size === 0) return false
  const intersection = [...setA].filter(c => setB.has(c)).length
  const union = new Set([...setA, ...setB]).size
  return intersection / union >= 0.4
}

// Deterministic dedup: iterates files in the ALREADY-ORDERED sequence.
// First occurrence of a near-duplicate wins (it's from the earlier/more-foundational file).
function deduplicateStages(orderedFileResults: PerFileResult[]): DedupedStage[] {
  const deduped: DedupedStage[] = []
  for (const { file_name, stages } of orderedFileResults) {
    for (const stage of stages) {
      const existing = deduped.find(d => stagesOverlap(d, stage))
      if (existing) {
        if (!existing.source_files.includes(file_name)) existing.source_files.push(file_name)
        for (const c of stage.key_concepts) {
          if (!existing.key_concepts.includes(c)) existing.key_concepts.push(c)
        }
      } else {
        deduped.push({
          name: stage.name,
          key_concepts: [...stage.key_concepts],
          prerequisite_knowledge: [...stage.prerequisite_knowledge],
          source_files: [file_name],
        })
      }
    }
  }
  return deduped
}

function topoSortStages(stages: DedupedStage[]): DedupedStage[] {
  const n = stages.length
  const inDegree = new Array(n).fill(0)
  const adj: number[][] = Array.from({ length: n }, () => [])

  for (let b = 0; b < n; b++) {
    if (stages[b].prerequisite_knowledge.length === 0) continue
    for (let a = 0; a < n; a++) {
      if (a === b) continue
      const matched = stages[b].prerequisite_knowledge.some(prereq =>
        stages[a].key_concepts.some(concept => jaccardSimilarity(prereq, concept) >= 0.35)
      )
      if (matched && !adj[a].includes(b)) {
        adj[a].push(b)
        inDegree[b]++
      }
    }
  }

  const queue: number[] = []
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i)
  }
  queue.sort((a, b) => a - b)

  const result: DedupedStage[] = []
  while (queue.length > 0) {
    const idx = queue.shift()!
    result.push(stages[idx])
    for (const next of adj[idx]) {
      inDegree[next]--
      if (inDegree[next] === 0) {
        const pos = queue.findIndex(i => i > next)
        pos === -1 ? queue.push(next) : queue.splice(pos, 0, next)
      }
    }
  }

  if (result.length < n) {
    const seen = new Set(result)
    console.warn(`[ai] topoSort: cycle detected, appending ${n - result.length} stages in original order`)
    for (const s of stages) {
      if (!seen.has(s)) result.push(s)
    }
  }

  return result
}

// Extract a numeric course position from filenames like "Lecture04", "Week 2", "Chapter 3"
function extractCoursePosition(fileName: string): number | null {
  const m = fileName.match(/(?:lecture|lec|week|wk|chapter|ch|unit|topic)\s*[-_]?\s*0*(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

function fuzzyMapTopicNames(
  topicNames: string[],
  topicNameToId: Map<string, string>
): string[] {
  return topicNames
    .map(name => {
      const exact = topicNameToId.get(name.toLowerCase())
      if (exact) return exact
      const partial = [...topicNameToId.entries()].find(([k]) =>
        k.includes(name.toLowerCase()) || name.toLowerCase().includes(k)
      )
      return partial?.[1] ?? null
    })
    .filter(Boolean) as string[]
}

const PER_FILE_CHAR_LIMIT = 460000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id: subject_id } = req.query as { id: string }

  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('id, name, exam_format_text')
    .eq('id', subject_id)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Subject not found' })

  const { ordering_mode } = (req.body ?? {}) as { ordering_mode?: 'upload_order' | 'ai_organised' }
  const orderingMode: 'upload_order' | 'ai_organised' = ordering_mode ?? 'ai_organised'

  const { data: materials } = await supabaseAdmin
    .from('materials')
    .select('id, file_name, upload_order')
    .eq('subject_id', subject_id)
    .eq('material_type', 'course_lecture_material')
    .order('upload_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (!materials || materials.length === 0) {
    return res.status(400).json({ error: 'No lecture material found for this subject' })
  }

  const examFormat = subject.exam_format_text ?? 'university written exam'
  const subjectName = subject.name ?? 'Unknown Subject'

  const allFileData: Array<{ material: { id: string; file_name: string }; fileContent: string }> = []

  for (const material of materials) {
    const { data: chunks } = await supabaseAdmin
      .from('chunks')
      .select('content, metadata')
      .eq('material_id', material.id)

    if (!chunks || chunks.length === 0) continue

    const sorted = [...chunks].sort((a, b) => {
      const ai = (a.metadata as any)?.chunk_index ?? 0
      const bi = (b.metadata as any)?.chunk_index ?? 0
      return ai - bi
    })

    const headings = [...new Set(
      sorted
        .map(c => (c.metadata as any)?.heading)
        .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    )]

    const fullText = sorted.map(c => c.content).join('\n\n')
    const toc = headings.length > 0 ? `[SECTIONS: ${headings.join(' | ')}]\n\n` : ''
    const fileContent = `${toc}${fullText}`.slice(0, PER_FILE_CHAR_LIMIT)

    console.log(`[ai] file="${material.file_name}" chars=${fullText.length} sent=${fileContent.length}`)
    allFileData.push({ material, fileContent })
  }

  if (allFileData.length === 0) {
    return res.status(400).json({ error: 'No lecture chunks found for this subject' })
  }

  console.log(`[ai] build-path subject=${subject_id} files=${allFileData.length} — pass 1 (parallel per-file)`)

  // ── PASS 1: per-file decomposition in parallel ─────────────────────────────
  // Each file processed independently → same granularity as single-file processing.
  // Stages come out in DOCUMENT ORDER from each file (correct within-file sequence).
  const perFileResults: PerFileResult[] = await Promise.all(
    allFileData.map(async ({ material, fileContent }) => {
      const r = await openai.chat.completions.parse({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a curriculum designer. Decompose a single lecture file into granular study stages.',
          },
          {
            role: 'user',
            content: PROMPTS.perFileDecompose(fileContent, material.file_name, examFormat),
          },
        ],
        response_format: zodResponseFormat(PerFileSchema, 'per_file_stages'),
      })

      const stages = r.choices[0].message.parsed?.stages ?? []
      const lectureNum = extractCoursePosition(material.file_name)
      console.log(`[ai] pass1 file="${material.file_name}" (lecture#${lectureNum ?? '?'}) → ${stages.length} stages: ${stages.map(s => s.name).join(' | ')}`)
      return { file_name: material.file_name, lecture_num: lectureNum, stages }
    })
  )

  const totalProposed = perFileResults.reduce((n, f) => n + f.stages.length, 0)
  console.log(`[ai] pass1 complete — ${totalProposed} proposed stages across ${perFileResults.length} files`)

  // ── FILE ORDERING ─────────────────────────────────────────────────────────
  const hasNumbers = perFileResults.some(f => f.lecture_num !== null)
  let orderedFiles: PerFileResult[]

  if (orderingMode === 'upload_order') {
    // Preserve DB fetch order (upload_order ASC, created_at ASC fallback) — no filename/number sort
    orderedFiles = perFileResults
    console.log(`[ai] file order (upload_order preserved): ${orderedFiles.map(f => f.file_name).join(' → ')}`)
  } else if (hasNumbers) {
    // ai_organised + lecture numbers present — sort by lecture number
    orderedFiles = [...perFileResults].sort((a, b) => {
      if (a.lecture_num !== null && b.lecture_num !== null) return a.lecture_num - b.lecture_num
      if (a.lecture_num !== null) return -1
      if (b.lecture_num !== null) return 1
      return 0
    })
    console.log(`[ai] file order (by lecture#): ${orderedFiles.map(f => `${f.file_name}(#${f.lecture_num})`).join(' → ')}`)
  } else {
    // ai_organised + no numbers — GPT orderFiles
    const fileDescriptions = perFileResults.map(f => {
      const stageLines = f.stages.map(s =>
        `  • ${s.name} [${s.key_concepts.slice(0, 2).join(', ')}]`
      ).join('\n')
      return `${f.file_name}:\n${stageLines}`
    }).join('\n\n')

    const fo = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: PROMPTS.orderFiles(fileDescriptions, subjectName) },
      ],
      response_format: zodResponseFormat(FileOrderSchema, 'file_order'),
    })

    const orderedNames = fo.choices[0].message.parsed?.ordered_file_names ?? perFileResults.map(f => f.file_name)
    orderedFiles = orderedNames
      .map(name => perFileResults.find(f => f.file_name === name))
      .filter(Boolean) as PerFileResult[]

    for (const f of perFileResults) {
      if (!orderedFiles.find(o => o.file_name === f.file_name)) orderedFiles.push(f)
    }
    console.log(`[ai] file order (by GPT): ${orderedFiles.map(f => f.file_name).join(' → ')}`)
  }

  // ── CODE DEDUP ─────────────────────────────────────────────────────────────
  // Now that files are in correct order, dedup preserves within-file sequence
  // and cross-file order. First occurrence wins — it's from the earlier file.
  const deduped = deduplicateStages(orderedFiles)
  console.log(`[ai] dedup: ${totalProposed} → ${deduped.length} stages (removed ${totalProposed - deduped.length} near-duplicates)`)

  // ── STAGE ORDERING ────────────────────────────────────────────────────────
  // GPT ordering pass — compact metadata only, no lecture content.
  // Topo sort is kept as a fallback if GPT fails twice.
  const stageMetadata = deduped.map((s, i) => ({
    id: `stage_${i}`,
    name: s.name,
    key_concepts: s.key_concepts,
    prerequisite_knowledge: s.prerequisite_knowledge,
    source_files: s.source_files,
  }))
  const expectedIds = new Set(stageMetadata.map(s => s.id))

  const stagesJson = JSON.stringify(stageMetadata, null, 2)
  const orderPrompt = orderingMode === 'upload_order'
    ? PROMPTS.orderStagesConservative(stagesJson, deduped.length, subjectName, examFormat)
    : PROMPTS.orderStages(stagesJson, deduped.length, subjectName, examFormat)

  async function attemptGptOrder(): Promise<DedupedStage[] | null> {
    try {
      const ro = await openai.chat.completions.parse({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: orderingMode === 'upload_order'
              ? 'You are a curriculum designer reviewing stage ordering. Preserve the student\'s intended sequence; only fix explicit prerequisite violations.'
              : 'You are a curriculum designer ordering study stages for optimal exam preparation.',
          },
          {
            role: 'user',
            content: orderPrompt,
          },
        ],
        response_format: zodResponseFormat(StageOrderSchema, 'stage_order'),
      })
      const ids = ro.choices[0].message.parsed?.ordered_stage_ids ?? []
      if (
        ids.length !== deduped.length ||
        new Set(ids).size !== deduped.length ||
        ids.some(id => !expectedIds.has(id))
      ) {
        console.warn(`[ai] GPT order invalid: returned ${ids.length} ids, expected ${deduped.length}`)
        return null
      }
      const indexMap = new Map(stageMetadata.map((s, i) => [s.id, i]))
      return ids.map(id => deduped[indexMap.get(id)!])
    } catch (err) {
      console.warn(`[ai] GPT order error: ${err}`)
      return null
    }
  }

  let finalOrdered: DedupedStage[]
  let orderMethod: string

  const gptOrder = await attemptGptOrder()
  if (gptOrder) {
    finalOrdered = gptOrder
    orderMethod = 'gpt_pedagogical_stage_order'
  } else {
    console.warn(`[ai] GPT order failed, retrying once`)
    const retry = await attemptGptOrder()
    if (retry) {
      finalOrdered = retry
      orderMethod = 'gpt_pedagogical_stage_order (retry)'
    } else {
      // GPT failed twice — fall back to topo sort then original order
      const topoOrdered = topoSortStages(deduped)
      const topoReorderedCount = deduped.filter((s, i) => topoOrdered.indexOf(s) !== i).length
      if (topoReorderedCount > 0) {
        finalOrdered = topoOrdered
        orderMethod = 'fallback_topological_order'
      } else {
        finalOrdered = deduped
        orderMethod = 'fallback_original_order'
      }
    }
  }

  console.log(`[ai] stage order method: ${orderMethod}`)

  // ── PASS 2: enrich only ────────────────────────────────────────────────────
  // Stages are in final pedagogical order. GPT only extracts topics + fills details.
  // No ordering task → no ordering errors. Explicit stageCount constraint prevents compression.
  const stageList = finalOrdered.map((s, i) =>
    `${i + 1}. ${s.name}\n   Source files: ${s.source_files.join(', ')}\n   Concepts: ${s.key_concepts.join(', ')}` +
    (s.prerequisite_knowledge.length > 0
      ? `\n   Prerequisites: ${s.prerequisite_knowledge.join(', ')}`
      : '')
  ).join('\n\n')

  console.log(`[ai] pass2 enriching ${finalOrdered.length} ordered stages`)

  const r2 = await openai.chat.completions.parse({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a curriculum designer. Extract topics and fill in study stage details.',
      },
      {
        role: 'user',
        content: PROMPTS.enrichStages(stageList, deduped.length, subjectName, examFormat),
      },
    ],
    response_format: zodResponseFormat(EnrichSchema, 'enriched_study_path'),
  })

  const result = r2.choices[0].message.parsed
  if (!result || result.topics.length === 0 || result.stages.length === 0) {
    return res.status(500).json({ error: 'AI failed to enrich stages' })
  }

  console.log(`[ai] pass2 complete — ${result.topics.length} topics, ${result.stages.length} stages`)
  if (result.stages.length < deduped.length) {
    console.warn(`[ai] WARNING: pass2 dropped ${deduped.length - result.stages.length} stages`)
  }

  // Clear cached stage content before rebuilding
  const { data: existingStages } = await supabaseAdmin
    .from('study_stages')
    .select('id')
    .eq('subject_id', subject_id)
  const existingStageIds = existingStages?.map(s => s.id) ?? []

  if (existingStageIds.length > 0) {
    await supabaseAdmin.from('stage_context_cache').delete().in('stage_id', existingStageIds)
    await supabaseAdmin.from('generated_items').delete().in('stage_id', existingStageIds)
    await supabaseAdmin.from('questions').delete().in('stage_id', existingStageIds)
  }

  await supabaseAdmin.from('topics').delete().eq('subject_id', subject_id)

  const { data: topicsInserted, error: topicsErr } = await supabaseAdmin
    .from('topics')
    .insert(result.topics.map((t, i) => ({
      subject_id,
      name: t.name,
      description: t.description,
      weight: t.weight,
      display_order: i,
    })))
    .select()
  if (topicsErr) return res.status(500).json({ error: topicsErr.message })

  await supabaseAdmin.from('study_stages').delete().eq('subject_id', subject_id)

  const topicNameToId = new Map((topicsInserted ?? []).map(t => [t.name.toLowerCase(), t.id]))

  const stageRows = result.stages.map((stage, i) => ({
    subject_id,
    name: stage.name,
    topic_ids: fuzzyMapTopicNames(stage.topic_names, topicNameToId),
    stage_order: i + 1,
    estimated_minutes: stage.estimated_minutes,
    status: 'not_started' as const,
    material_types: stage.material_types,
    test_types: stage.test_types,
  }))

  const { error: stagesErr } = await supabaseAdmin.from('study_stages').insert(stageRows)
  if (stagesErr) return res.status(500).json({ error: stagesErr.message })

  return res.status(200).json({
    topics_count: topicsInserted?.length ?? 0,
    stages_count: stageRows.length,
    files_processed: perFileResults.length,
    stages_proposed: totalProposed,
    stages_after_dedup: deduped.length,
  })
}
