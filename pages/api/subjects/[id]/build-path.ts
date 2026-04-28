import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const BuildSubjectSchema = z.object({
  topics: z.array(z.object({
    name: z.string(),
    description: z.string(),
    weight: z.number().min(0).max(1),
  })),
  stages: z.array(z.object({
    name: z.string(),
    topic_names: z.array(z.string()),
    estimated_minutes: z.number().int().min(10).max(120),
    material_types: z.array(z.enum(['summary', 'flashcards', 'concept_map'])),
    test_types: z.array(z.enum(['recall', 'mcq'])),
    rationale: z.string().nullable().optional(),
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

  // Fetch all lecture materials for this subject
  const { data: materials } = await supabaseAdmin
    .from('materials')
    .select('id, file_name')
    .eq('subject_id', subject_id)
    .eq('material_type', 'course_lecture_material')
    .order('created_at')

  if (!materials || materials.length === 0) {
    return res.status(400).json({ error: 'No lecture material found for this subject' })
  }

  // Build a labeled sample from each file — every file gets its own section
  // Budget: 40k chars total, split evenly across files
  const charBudgetPerFile = Math.floor(40000 / materials.length)
  const sections: string[] = []

  for (const material of materials) {
    const { data: chunks } = await supabaseAdmin
      .from('chunks')
      .select('content')
      .eq('material_id', material.id)
      .order('id')

    if (!chunks || chunks.length === 0) continue

    // Take an evenly-spaced sample from this file's chunks
    const targetChunks = Math.max(4, Math.floor(charBudgetPerFile / 500))
    const step = Math.max(1, Math.floor(chunks.length / targetChunks))
    const sample = chunks
      .filter((_, i) => i % step === 0)
      .map(c => c.content.slice(0, 500))
      .join('\n\n')
      .slice(0, charBudgetPerFile)

    sections.push(`=== FILE: ${material.file_name} ===\n${sample}`)
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
      { role: 'system', content: 'You are a curriculum designer. Extract topics and build a study path from course materials.' },
      { role: 'user', content: PROMPTS.buildSubject(combinedSample, examFormat, subjectName, materials.length) },
    ],
    response_format: zodResponseFormat(BuildSubjectSchema, 'build_subject'),
  })

  const result = r.choices[0].message.parsed
  if (!result || result.topics.length === 0 || result.stages.length === 0) {
    return res.status(500).json({ error: 'AI failed to generate topics and stages' })
  }

  // Wipe and rebuild topics + stages
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
  })
}
