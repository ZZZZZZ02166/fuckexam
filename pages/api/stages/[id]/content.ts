import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai, embedText } from '@/lib/openai'
import { PROMPTS } from '@/lib/prompts'
import type { MaterialType, SummaryContent, FlashcardsContent, ConceptMapContent, Json } from '@/types/database'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const SummarySchema = z.object({ text: z.string(), key_terms: z.array(z.string()) })
const FlashcardsSchema = z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })) })
const ConceptMapSchema = z.object({
  root: z.string(),
  tree: z.array(z.object({
    label: z.string(),
    detail: z.string().optional(),
    children: z.array(z.object({ label: z.string(), detail: z.string().optional() })).optional(),
  }))
})

async function getStageContext(stageId: string, topicNames: string[]): Promise<string> {
  // Embed the topic names query to find relevant chunks
  const query = topicNames.join(', ')
  const queryEmbedding = await embedText(query)

  // Vector similarity search via RPC
  const { data: chunks } = await supabaseAdmin.rpc('match_chunks_for_stage', {
    stage_id_input: stageId,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: 8,
  })

  if (!chunks?.length) {
    // Fallback: get any chunks from the subject's materials
    const { data: stage } = await supabaseAdmin
      .from('study_stages')
      .select('subject_id')
      .eq('id', stageId)
      .single()

    if (!stage) return ''

    const { data: fallbackChunks } = await supabaseAdmin
      .from('chunks')
      .select('content, metadata')
      .in('material_id',
        supabaseAdmin
          .from('materials')
          .select('id')
          .eq('subject_id', stage.subject_id) as any
      )
      .limit(8)

    return (fallbackChunks ?? []).map((c: any) => c.content).join('\n\n')
  }

  return (chunks as any[]).map((c: any) => c.content).join('\n\n')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id: stage_id } = req.query as { id: string }
  const { type } = req.body as { type: MaterialType }

  if (!['summary', 'flashcards', 'concept_map'].includes(type)) {
    return res.status(400).json({ error: 'type must be summary | flashcards | concept_map' })
  }

  // Verify user owns this stage's subject
  const { data: stage } = await supabaseAdmin
    .from('study_stages')
    .select('*, subjects!inner(user_id, exam_format_text)')
    .eq('id', stage_id)
    .single()
  if (!stage || (stage as any).subjects.user_id !== user.id) {
    return res.status(404).json({ error: 'Stage not found' })
  }

  // Check cache
  const { data: existing } = await supabaseAdmin
    .from('generated_items')
    .select('*')
    .eq('stage_id', stage_id)
    .eq('type', type)
    .single()
  if (existing) return res.status(200).json(existing)

  // Get topic names for this stage
  const { data: topics } = await supabaseAdmin
    .from('topics')
    .select('name')
    .in('id', stage.topic_ids ?? [])
  const topicNames = topics?.map(t => t.name).join(', ') ?? stage.name
  const examFormat = (stage as any).subjects.exam_format_text ?? 'university written exam'

  const context = await getStageContext(stage_id, topics?.map(t => t.name) ?? [stage.name])

  let content: SummaryContent | FlashcardsContent | ConceptMapContent

  if (type === 'summary') {
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You write concise study summaries for university students.' },
        { role: 'user', content: PROMPTS.generateSummary(topicNames, examFormat, context) },
      ],
      response_format: zodResponseFormat(SummarySchema, 'summary'),
    })
    content = r.choices[0].message.parsed as SummaryContent

  } else if (type === 'flashcards') {
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate flashcards for university exam preparation.' },
        { role: 'user', content: PROMPTS.generateFlashcards(topicNames, examFormat, context) },
      ],
      response_format: zodResponseFormat(FlashcardsSchema, 'flashcards'),
    })
    content = r.choices[0].message.parsed as FlashcardsContent

  } else {
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate concept maps for university study.' },
        { role: 'user', content: PROMPTS.generateConceptMap(topicNames, context) },
      ],
      response_format: zodResponseFormat(ConceptMapSchema, 'concept_map'),
    })
    content = r.choices[0].message.parsed as ConceptMapContent
  }

  const { data: item, error } = await supabaseAdmin
    .from('generated_items')
    .insert({ stage_id, type, content: content as unknown as Json })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })

  // Mark stage in_progress if it was not_started
  if (stage.status === 'not_started') {
    await supabaseAdmin
      .from('study_stages')
      .update({ status: 'in_progress' })
      .eq('id', stage_id)
  }

  return res.status(201).json(item)
}
