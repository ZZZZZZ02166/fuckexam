import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai, embedText } from '@/lib/openai'
import { chunkText } from '@/lib/chunker'
import { buildMaterialSample } from '@/lib/materialSample'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const BodySchema = z.object({
  subject_id: z.string().uuid(),
  storage_path: z.string(),
  file_name: z.string(),
  material_type: z.enum([
    'course_lecture_material',
    'tutorial_material',
    'past_exam_questions',
    'exam_solutions_marking_guide',
  ]).default('course_lecture_material'),
})

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

// Fallback schemas for two-step flow
const TopicsSchema = z.object({
  topics: z.array(z.object({
    name: z.string(),
    description: z.string(),
    weight: z.number().min(0).max(1),
  }))
})

const PathSchema = z.object({
  stages: z.array(z.object({
    name: z.string(),
    topic_names: z.array(z.string()),
    estimated_minutes: z.number().int().min(10).max(120),
    material_types: z.array(z.enum(['summary', 'flashcards', 'concept_map'])),
    test_types: z.array(z.enum(['recall', 'mcq'])),
    rationale: z.string().nullable().optional(),
  }))
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

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { subject_id, storage_path, file_name, material_type } = parsed.data

  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('id, name, exam_format_text')
    .eq('id', subject_id)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Subject not found' })

  const { data: material, error: materialErr } = await supabaseAdmin
    .from('materials')
    .insert({ subject_id, file_name, storage_path, material_type })
    .select()
    .single()
  if (materialErr) return res.status(500).json({ error: materialErr.message })

  const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage
    .from('materials')
    .download(storage_path)
  if (downloadErr || !fileBlob) {
    return res.status(500).json({ error: 'Could not download uploaded file' })
  }

  let fullText = ''
  try {
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const buffer = Buffer.from(await fileBlob.arrayBuffer())
    const result = await pdfParse(buffer)
    fullText = result.text
  } catch {
    return res.status(500).json({ error: 'Failed to parse PDF' })
  }

  if (!fullText.trim()) {
    return res.status(400).json({ error: 'No text could be extracted from file' })
  }

  const chunks = chunkText(fullText)
  const chunksWithEmbeddings = await Promise.all(
    chunks.map(async chunk => ({ ...chunk, embedding: await embedText(chunk.content) }))
  )

  const { error: chunksErr } = await supabaseAdmin.from('chunks').insert(
    chunksWithEmbeddings.map(c => ({
      material_id: material.id,
      content: c.content,
      embedding: JSON.stringify(c.embedding),
      metadata: c.metadata,
      material_type,
    }))
  )
  if (chunksErr) return res.status(500).json({ error: chunksErr.message })

  // Non-lecture materials are stored for RAG augmentation only — no topic/stage generation.
  if (material_type !== 'course_lecture_material') {
    await supabaseAdmin
      .from('materials')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', material.id)
    return res.status(200).json({ material_id: material.id, chunks_count: chunks.length })
  }

  const examFormat = (subject as any).exam_format_text ?? 'university written exam'
  const subjectName = (subject as any).name ?? 'Unknown Subject'

  // Attempt combined topics + stages in one GPT-4o call
  let extractedTopics: z.infer<typeof BuildSubjectSchema>['topics'] = []
  let generatedStages: z.infer<typeof BuildSubjectSchema>['stages'] = []
  let usedCombined = false

  try {
    const materialSample = buildMaterialSample(fullText, chunksWithEmbeddings)
    console.log('[ai] process-material build_subject model=gpt-4o subject=', subject_id)
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a curriculum designer. Extract topics and build a study path from course materials.' },
        { role: 'user', content: PROMPTS.buildSubject(materialSample, examFormat, subjectName) },
      ],
      response_format: zodResponseFormat(BuildSubjectSchema, 'build_subject'),
    })
    const result = r.choices[0].message.parsed
    if (result && result.topics.length > 0 && result.stages.length > 0) {
      extractedTopics = result.topics
      generatedStages = result.stages
      usedCombined = true
    } else {
      throw new Error('empty_result')
    }
  } catch {
    console.log('[ai] process-material build_subject_failed fallback=two_step subject=', subject_id)

    // Fallback: two-step flow
    const topicResponse = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You extract topics from university course materials for exam preparation.' },
        { role: 'user', content: PROMPTS.extractTopics(fullText) },
      ],
      response_format: zodResponseFormat(TopicsSchema, 'topics'),
    })
    extractedTopics = topicResponse.choices[0].message.parsed?.topics ?? []

    const pathResponse = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a curriculum designer. Your study paths are structured like textbook chapters: each stage covers ONLY new concepts not introduced in any previous stage. Later stages assume mastery of earlier ones.' },
        { role: 'user', content: PROMPTS.generatePath(
          JSON.stringify(extractedTopics.map(t => ({ name: t.name, description: t.description, weight: t.weight }))),
          examFormat
        )},
      ],
      response_format: zodResponseFormat(PathSchema, 'path'),
    })
    generatedStages = pathResponse.choices[0].message.parsed?.stages ?? []
  }

  // Delete any existing topics for this subject before reinserting
  await supabaseAdmin.from('topics').delete().eq('subject_id', subject_id)

  const { data: topicsInserted, error: topicsErr } = await supabaseAdmin
    .from('topics')
    .insert(extractedTopics.map((t, i) => ({
      subject_id,
      name: t.name,
      description: t.description,
      weight: t.weight,
      display_order: i,
    })))
    .select()
  if (topicsErr) return res.status(500).json({ error: topicsErr.message })

  // Delete existing stages before inserting new ones
  await supabaseAdmin.from('study_stages').delete().eq('subject_id', subject_id)

  const topicNameToId = new Map((topicsInserted ?? []).map(t => [t.name.toLowerCase(), t.id]))

  const stageRows = generatedStages.map((stage, i) => ({
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

  await supabaseAdmin
    .from('materials')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', material.id)

  return res.status(200).json({
    material_id: material.id,
    chunks_count: chunks.length,
    topics: topicsInserted,
    stages_count: stageRows.length,
    combined: usedCombined,
  })
}
