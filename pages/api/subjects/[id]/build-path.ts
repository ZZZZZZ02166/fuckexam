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

// File ordering fallback (kept for safety — not called in module-first flow)
const FileOrderSchema = z.object({
  ordered_file_names: z.array(z.string()),
})

// Module ordering
const ModuleOrderSchema = z.object({
  ordered_module_ids: z.array(z.string()),
})

// Pedagogical stage ordering (kept for safety — not called in module-first flow)
const StageOrderSchema = z.object({
  ordered_stage_ids: z.array(z.string()),
})

// Post-dedup consolidation: identify genuinely redundant stages
const ConsolidationSchema = z.object({
  merges: z.array(z.object({
    keep_id: z.number().int().min(1),
    absorb_ids: z.array(z.number().int().min(1)),
    reason: z.string(),
  })),
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

interface StageWithModule {
  stage: DedupedStage
  module: { material_id: string; file_name: string; module_order: number }
}

function normalizeConcept(concept: string): string {
  return concept
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|and|of|in|to|a|an|curve|model|concept|concepts|basic|basics)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function conceptsMatch(a: string, b: string): boolean {
  const na = normalizeConcept(a)
  const nb = normalizeConcept(b)
  if (!na || !nb) return false
  if (na === nb) return true
  return (na.length >= 8 && nb.includes(na)) || (nb.length >= 8 && na.includes(nb))
}

function uniqueConcepts(concepts: string[]): string[] {
  const result: string[] = []
  for (const concept of concepts.map(c => c.trim()).filter(Boolean)) {
    if (!result.some(existing => conceptsMatch(existing, concept))) result.push(concept)
  }
  return result
}

function computeStageScopes(stages: DedupedStage[]): Array<{
  key_concepts: string[]
  prerequisite_concepts: string[]
  review_concepts: string[]
}> {
  const ownedConcepts: string[] = []

  return stages.map(stage => {
    const rawKeyConcepts = uniqueConcepts(stage.key_concepts)
    const review_concepts = rawKeyConcepts.filter(concept =>
      ownedConcepts.some(existing => conceptsMatch(existing, concept))
    )
    let key_concepts = rawKeyConcepts.filter(concept =>
      !review_concepts.some(review => conceptsMatch(review, concept))
    )

    if (key_concepts.length === 0) {
      key_concepts = [stage.name]
    }

    for (const concept of key_concepts) {
      if (!ownedConcepts.some(existing => conceptsMatch(existing, concept))) ownedConcepts.push(concept)
    }

    const prerequisite_concepts = uniqueConcepts([
      ...stage.prerequisite_knowledge,
      ...review_concepts,
    ]).filter(concept => !key_concepts.some(key => conceptsMatch(key, concept)))

    return { key_concepts, prerequisite_concepts, review_concepts }
  })
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

// Cross-file dedup: first occurrence wins; subsequent files add to source_files
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

// Conservative post-dedup consolidation pass: merge genuinely redundant stages
async function consolidateStages(deduped: DedupedStage[]): Promise<DedupedStage[]> {
  if (deduped.length <= 1) return deduped

  const stageList = deduped.map((s, i) =>
    `${i + 1}. "${s.name}" | concepts: [${s.key_concepts.join(', ')}]` +
    (s.prerequisite_knowledge.length > 0
      ? ` | prerequisites: [${s.prerequisite_knowledge.join(', ')}]`
      : '')
  ).join('\n')

  try {
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a curriculum quality reviewer identifying genuinely redundant study stages.' },
        { role: 'user', content: PROMPTS.consolidateStages(stageList) },
      ],
      response_format: zodResponseFormat(ConsolidationSchema, 'consolidation'),
    })

    const merges = r.choices[0].message.parsed?.merges ?? []
    if (merges.length === 0) {
      console.log('[build-path] consolidation: no redundant stages found')
      return deduped
    }

    // Validate: ids in range, no stage is both keeper and absorbed
    const allAbsorbIds = new Set(merges.flatMap(m => m.absorb_ids))
    const validMerges = merges.filter(m => {
      if (m.keep_id < 1 || m.keep_id > deduped.length) return false
      if (allAbsorbIds.has(m.keep_id)) return false
      if (m.absorb_ids.some(id => id < 1 || id > deduped.length || id === m.keep_id)) return false
      return true
    })

    if (validMerges.length === 0) {
      console.log('[build-path] consolidation: proposed merges were invalid, keeping original stages')
      return deduped
    }

    const result = deduped.map(s => ({
      ...s,
      key_concepts: [...s.key_concepts],
      prerequisite_knowledge: [...s.prerequisite_knowledge],
      source_files: [...s.source_files],
    }))
    const toRemove = new Set<number>()

    for (const merge of validMerges) {
      const keepIdx = merge.keep_id - 1
      const keeper = result[keepIdx]
      for (const absorbId of merge.absorb_ids) {
        const absorbIdx = absorbId - 1
        if (toRemove.has(absorbIdx)) continue
        const absorbed = result[absorbIdx]
        for (const c of absorbed.key_concepts) {
          if (!keeper.key_concepts.includes(c)) keeper.key_concepts.push(c)
        }
        for (const p of absorbed.prerequisite_knowledge) {
          if (!keeper.prerequisite_knowledge.includes(p)) keeper.prerequisite_knowledge.push(p)
        }
        for (const f of absorbed.source_files) {
          if (!keeper.source_files.includes(f)) keeper.source_files.push(f)
        }
        toRemove.add(absorbIdx)
        console.log(`[build-path] consolidation merge: stage "${absorbed.name}" → "${keeper.name}" | reason: ${merge.reason}`)
      }
    }

    const consolidated = result.filter((_, i) => !toRemove.has(i))
    console.log(`[build-path] consolidation: ${deduped.length} → ${consolidated.length} stages (merged ${toRemove.size})`)
    return consolidated
  } catch (err) {
    console.warn(`[build-path] consolidation error: ${err} — keeping original ${deduped.length} stages`)
    return deduped
  }
}

// Kept for safety — not called in module-first flow
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

  // ── MODULE ORDERING ───────────────────────────────────────────────────────
  // Build compact metadata per module for AI ordering
  const modulesMeta = allFileData.map(({ material }, idx) => {
    const pf = perFileResults[idx]
    return {
      id: material.id,
      file_name: material.file_name,
      stage_names: pf.stages.map(s => s.name),
      key_concepts: [...new Set(pf.stages.flatMap(s => s.key_concepts))].slice(0, 20),
      prerequisite_knowledge: [...new Set(pf.stages.flatMap(s => s.prerequisite_knowledge))].slice(0, 10),
    }
  })

  async function attemptModuleOrder(): Promise<string[] | null> {
    try {
      const ro = await openai.chat.completions.parse({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a curriculum designer ordering lecture modules for optimal learning flow.' },
          { role: 'user', content: PROMPTS.orderModules(JSON.stringify(modulesMeta, null, 2), subjectName, examFormat) },
        ],
        response_format: zodResponseFormat(ModuleOrderSchema, 'module_order'),
      })
      const ids = ro.choices[0].message.parsed?.ordered_module_ids ?? []
      const expectedIds = new Set(modulesMeta.map(m => m.id))
      if (ids.length !== modulesMeta.length || ids.some(id => !expectedIds.has(id)) || new Set(ids).size !== ids.length) {
        console.warn(`[ai] module order invalid: got ${ids.length}, expected ${modulesMeta.length}`)
        return null
      }
      return ids
    } catch (err) {
      console.warn(`[ai] module order error: ${err}`)
      return null
    }
  }

  // Kept for safety — not called in module-first flow
  async function attemptGptOrder(stageMeta: Array<{ id: string; name: string; key_concepts: string[]; prerequisite_knowledge: string[]; source_files: string[] }>, deduped: DedupedStage[], prompt: string): Promise<DedupedStage[] | null> {
    const expectedIds = new Set(stageMeta.map(s => s.id))
    try {
      const ro = await openai.chat.completions.parse({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a curriculum designer ordering study stages for optimal exam preparation.' },
          { role: 'user', content: prompt },
        ],
        response_format: zodResponseFormat(StageOrderSchema, 'stage_order'),
      })
      const ids = ro.choices[0].message.parsed?.ordered_stage_ids ?? []
      if (ids.length !== deduped.length || new Set(ids).size !== deduped.length || ids.some(id => !expectedIds.has(id))) {
        console.warn(`[ai] GPT order invalid: returned ${ids.length} ids, expected ${deduped.length}`)
        return null
      }
      const indexMap = new Map(stageMeta.map((s, i) => [s.id, i]))
      return ids.map(id => deduped[indexMap.get(id)!])
    } catch (err) {
      console.warn(`[ai] GPT order error: ${err}`)
      return null
    }
  }

  let orderedFiles: PerFileResult[]

  if (orderingMode === 'upload_order') {
    orderedFiles = perFileResults  // DB fetch order (upload_order ASC)
    console.log(`[ai] module order (upload_order): ${orderedFiles.map(f => f.file_name).join(' → ')}`)
  } else {
    // ai_organised: AI module ordering, retry once, then fallback
    const aiModuleOrder = (await attemptModuleOrder()) ?? (await attemptModuleOrder())
    if (aiModuleOrder) {
      const idToPerFile = new Map(allFileData.map((f, i) => [f.material.id, perFileResults[i]]))
      orderedFiles = aiModuleOrder.map(id => idToPerFile.get(id)!).filter(Boolean)
      // append any missing files (safety net)
      for (const pf of perFileResults) {
        if (!orderedFiles.includes(pf)) orderedFiles.push(pf)
      }
      console.log(`[ai] module order (AI): ${orderedFiles.map(f => f.file_name).join(' → ')}`)
    } else {
      // fallback: lecture number sort, then DB order
      const hasNumbers = perFileResults.some(f => f.lecture_num !== null)
      if (hasNumbers) {
        orderedFiles = [...perFileResults].sort((a, b) => {
          if (a.lecture_num !== null && b.lecture_num !== null) return a.lecture_num - b.lecture_num
          if (a.lecture_num !== null) return -1
          if (b.lecture_num !== null) return 1
          return 0
        })
      } else {
        orderedFiles = perFileResults
      }
      console.log(`[ai] module order (fallback): ${orderedFiles.map(f => f.file_name).join(' → ')}`)
    }
  }

  // ── CROSS-FILE DEDUP ──────────────────────────────────────────────────────
  const deduped = deduplicateStages(orderedFiles)
  console.log(`[ai] dedup: ${totalProposed} → ${deduped.length} stages (removed ${totalProposed - deduped.length} near-duplicates)`)

  // ── CONSOLIDATION PASS (conservative safety net) ──────────────────────────
  const consolidated = await consolidateStages(deduped)

  const crossFileMerged = deduped.filter(d => d.source_files.length > 1)
  if (crossFileMerged.length > 0) {
    console.log(`[ai] cross-file merged stages (${crossFileMerged.length}): ${crossFileMerged.map(d => `"${d.name}" [${d.source_files.join(', ')}]`).join(' | ')}`)
    console.log('[ai] merged stage module assignment: using source_files[0] as primary module')
  }

  const perModuleCounts = orderedFiles.map(f => ({
    file: f.file_name,
    raw: f.stages.length,
    deduped: deduped.filter(d => d.source_files[0] === f.file_name).length,
  }))
  console.log(`[ai] per-module stage counts: ${JSON.stringify(perModuleCounts)}`)

  // ── MODULE-FIRST STAGE ORDERING ───────────────────────────────────────────
  // Stages ordered by module, then dedup-iteration order within each module.
  // No global GPT stage reordering in module-first mode.

  const fileNameToModule = new Map<string, { material_id: string; file_name: string; module_order: number }>()
  orderedFiles.forEach((pf, idx) => {
    const mat = allFileData.find(f => f.material.file_name === pf.file_name)
    if (mat) {
      fileNameToModule.set(pf.file_name, {
        material_id: mat.material.id,
        file_name: pf.file_name,
        module_order: idx + 1,
      })
    }
  })

  // Group consolidated stages by primary source file (source_files[0])
  const moduleStageMap = new Map<string, DedupedStage[]>()
  for (const stage of consolidated) {
    const key = stage.source_files[0]
    if (!moduleStageMap.has(key)) moduleStageMap.set(key, [])
    moduleStageMap.get(key)!.push(stage)
  }

  // Flatten in module order
  const stagesWithModules: StageWithModule[] = []
  for (const pf of orderedFiles) {
    const moduleInfo = fileNameToModule.get(pf.file_name)
    if (!moduleInfo) continue
    const groupStages = moduleStageMap.get(pf.file_name) ?? []
    for (const stage of groupStages) {
      stagesWithModules.push({ stage, module: moduleInfo })
    }
  }

  const finalOrdered = stagesWithModules.map(sw => sw.stage)
  console.log(`[ai] stage order method: module_first (${stagesWithModules.length} stages across ${orderedFiles.length} modules)`)

  // ── PASS 2: enrich only ────────────────────────────────────────────────────
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
        content: PROMPTS.enrichStages(stageList, consolidated.length, subjectName, examFormat),
      },
    ],
    response_format: zodResponseFormat(EnrichSchema, 'enriched_study_path'),
  })

  const result = r2.choices[0].message.parsed
  if (!result || result.topics.length === 0 || result.stages.length === 0) {
    return res.status(500).json({ error: 'AI failed to enrich stages' })
  }

  console.log(`[ai] pass2 complete — ${result.topics.length} topics, ${result.stages.length} stages`)
  if (result.stages.length < consolidated.length) {
    console.warn(`[ai] WARNING: pass2 dropped ${consolidated.length - result.stages.length} stages`)
  }

  // Clear cached stage content before rebuilding
  const { data: existingStages } = await supabaseAdmin
    .from('study_stages')
    .select('id')
    .eq('subject_id', subject_id)
  const existingStageIds = existingStages?.map(s => s.id) ?? []

  if (existingStageIds.length > 0) {
    // Delete student_answers first — they FK into questions which FK into study_stages
    const { data: existingQuestions } = await supabaseAdmin
      .from('questions')
      .select('id')
      .in('stage_id', existingStageIds)
    const existingQuestionIds = existingQuestions?.map((q: { id: string }) => q.id) ?? []
    if (existingQuestionIds.length > 0) {
      await supabaseAdmin.from('student_answers').delete().in('question_id', existingQuestionIds)
    }
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
  const stageScopes = computeStageScopes(finalOrdered)

  // result.stages[i] is aligned with stagesWithModules[i] — Pass 2 preserves input order
  const stageRows = result.stages.map((stage, i) => ({
    subject_id,
    name: stage.name,
    topic_ids: fuzzyMapTopicNames(stage.topic_names, topicNameToId),
    stage_order: i + 1,
    estimated_minutes: stage.estimated_minutes,
    status: 'not_started' as const,
    material_types: stage.material_types,
    test_types: stage.test_types,
    source_material_id: stagesWithModules[i]?.module.material_id ?? null,
    source_file_name: stagesWithModules[i]?.module.file_name ?? null,
    module_order: stagesWithModules[i]?.module.module_order ?? null,
    key_concepts: stageScopes[i]?.key_concepts ?? [stage.name],
    prerequisite_concepts: stageScopes[i]?.prerequisite_concepts ?? [],
    review_concepts: stageScopes[i]?.review_concepts ?? [],
  }))

  const { error: stagesErr } = await supabaseAdmin.from('study_stages').insert(stageRows)
  if (stagesErr) return res.status(500).json({ error: stagesErr.message })

  return res.status(200).json({
    topics_count: topicsInserted?.length ?? 0,
    stages_count: stageRows.length,
    files_processed: perFileResults.length,
    stages_proposed: totalProposed,
    stages_after_dedup: deduped.length,
    stages_after_consolidation: consolidated.length,
  })
}
