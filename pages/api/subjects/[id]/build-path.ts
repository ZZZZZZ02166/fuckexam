import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const BuildSubjectSchema = z.object({
  // FIRST field: forces GPT to enumerate concepts per file BEFORE generating topics.
  // Prospective (plan before acting), not retrospective (check after acting).
  // OpenAI structured output fills fields in declared order — placing this first
  // guarantees the per-file analysis happens before topics/stages are committed.
  // suggested_stages: per-file mini decomposition — prevents GPT from compressing
  // many files into a "semester summary" count rather than preserving granularity.
  file_coverage_notes: z.array(z.object({
    file_name: z.string(),
    key_concepts: z.array(z.string()),
    exam_weight: z.enum(['high', 'medium', 'low']),
    suggested_stages: z.array(z.string()),
  })),
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

  const { data: materials } = await supabaseAdmin
    .from('materials')
    .select('id, file_name')
    .eq('subject_id', subject_id)
    .eq('material_type', 'course_lecture_material')
    .order('created_at')

  if (!materials || materials.length === 0) {
    return res.status(400).json({ error: 'No lecture material found for this subject' })
  }

  // GPT-4o context: 128k tokens ≈ 512k chars.
  // Reserve ~50k chars for prompt instructions + output. That leaves ~460k for material.
  // Strategy: load ALL chunks from all files first, measure total size, then decide:
  //   - If total fits: send everything (no assumptions, no sampling)
  //   - If total is too large: proportionally truncate per file based on actual file size
  const TOTAL_CHAR_LIMIT = 460000

  // Load all files' chunks upfront
  interface FileChunks {
    material: { id: string; file_name: string }
    sorted: Array<{ content: string; metadata: unknown }>
    headings: string[]
    fullText: string
  }

  const allFileData: FileChunks[] = []

  for (const material of materials) {
    const { data: chunks } = await supabaseAdmin
      .from('chunks')
      .select('content, metadata')
      .eq('material_id', material.id)

    if (!chunks || chunks.length === 0) continue

    // Sort by chunk_index for document order (UUID ordering is random)
    const sorted = [...chunks].sort((a, b) => {
      const ai = (a.metadata as any)?.chunk_index ?? 0
      const bi = (b.metadata as any)?.chunk_index ?? 0
      return ai - bi
    })

    // Extract unique section headings — slide/section titles, highest-signal content
    const headings = [...new Set(
      sorted
        .map(c => (c.metadata as any)?.heading)
        .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
    )]

    const fullText = sorted.map(c => c.content).join('\n\n')
    allFileData.push({ material, sorted, headings, fullText })
  }

  if (allFileData.length === 0) {
    return res.status(400).json({ error: 'No lecture chunks found for this subject' })
  }

  const totalChars = allFileData.reduce((sum, f) => sum + f.fullText.length, 0)
  console.log(`[ai] build-path subject=${subject_id} files=${allFileData.length} totalChars=${totalChars} limit=${TOTAL_CHAR_LIMIT}`)

  const sections: string[] = []

  if (totalChars <= TOTAL_CHAR_LIMIT) {
    // Everything fits — send full content from every file, no sampling
    for (const { material, headings, fullText } of allFileData) {
      const toc = headings.length > 0 ? `[SECTIONS: ${headings.join(' | ')}]\n\n` : ''
      sections.push(`=== FILE: ${material.file_name} ===\n${toc}${fullText}`)
      console.log(`[ai] file="${material.file_name}" chars=${fullText.length} (full)`)
    }
  } else {
    // Too large — allocate budget per file proportional to actual file size
    // Larger files get more budget; no file is artificially capped below its proportion
    for (const { material, sorted, headings, fullText } of allFileData) {
      const fileProportion = fullText.length / totalChars
      const charBudget = Math.floor(TOTAL_CHAR_LIMIT * fileProportion)

      const toc = headings.length > 0 ? `[SECTIONS: ${headings.join(' | ')}]\n\n` : ''
      const contentBudget = Math.max(0, charBudget - toc.length)

      // Sample evenly through document order within the proportional budget
      const targetChunks = Math.max(6, Math.floor(contentBudget / 400))
      const step = Math.max(1, Math.floor(sorted.length / targetChunks))
      const contentSample = sorted
        .filter((_, i) => i % step === 0)
        .map(c => c.content.slice(0, 400))
        .join('\n\n')
        .slice(0, contentBudget)

      sections.push(`=== FILE: ${material.file_name} ===\n${toc}${contentSample}`)
      console.log(`[ai] file="${material.file_name}" chars=${fullText.length} budget=${charBudget} (sampled)`)
    }
  }

  if (sections.length === 0) {
    return res.status(400).json({ error: 'No lecture chunks found for this subject' })
  }

  const combinedSample = sections.join('\n\n')
  const examFormat = subject.exam_format_text ?? 'university written exam'
  const subjectName = subject.name ?? 'Unknown Subject'

  console.log(`[ai] build-path subject=${subject_id} files=${materials.length} chars=${combinedSample.length}`)

  const r = await openai.chat.completions.parse({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a curriculum designer. Extract topics and build a complete study path from university course materials.' },
      { role: 'user', content: PROMPTS.buildSubject(combinedSample, examFormat, subjectName, materials.length) },
    ],
    response_format: zodResponseFormat(BuildSubjectSchema, 'build_subject'),
  })

  const result = r.choices[0].message.parsed
  if (!result || result.topics.length === 0 || result.stages.length === 0) {
    return res.status(500).json({ error: 'AI failed to generate topics and stages' })
  }

  // Log per-file coverage and source attribution
  for (const note of result.file_coverage_notes) {
    console.log(`[ai] file="${note.file_name}" weight=${note.exam_weight} concepts: ${note.key_concepts.join(', ')} suggested_stages: ${note.suggested_stages.join(' | ')}`)
  }
  for (const t of result.topics) {
    console.log(`[ai] topic="${t.name}" sources=${t.source_files.join(', ')}`)
  }
  for (const s of result.stages) {
    console.log(`[ai] stage="${s.name}" sources=${s.source_files.join(', ')}`)
  }

  // Explicitly clear cached stage content before rebuilding
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
    files_covered: result.file_coverage_notes.length,
  })
}
