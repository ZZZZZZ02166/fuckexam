import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai, embedText } from '@/lib/openai'
import { PROMPTS } from '@/lib/prompts'
import type { MaterialType, SummaryContent, FlashcardsContent, ConceptMapContent, Json } from '@/types/database'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const SummarySchema = z.object({
  quickOverview: z.array(z.string()),
  bigIdea: z.string(),
  keyConcepts: z.array(z.object({
    term: z.string(),
    explanation: z.string(),
    whyItMatters: z.string(),
  })),
  ideaConnections: z.array(z.object({
    from: z.string(),
    to: z.string(),
    relationship: z.string(),
  })),
  examTraps: z.array(z.object({
    trap: z.string(),
    correction: z.string(),
  })),
  quickCheck: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })),
  detailedNotes: z.string(),
})
const FlashcardsSchema = z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })) })
const NODE_TYPES = ['concept', 'problem', 'solution', 'exam_trap', 'code_example',
  'process', 'definition', 'comparison', 'limitation', 'evidence', 'formula', 'example'] as const
const NODE_IMPORTANCE = ['primary', 'secondary', 'supporting'] as const
const RELATIONSHIP_LABELS = [
  'leads to', 'solves', 'causes', 'enables', 'contrasts with',
  'is part of', 'requires', 'produces', 'defines', 'exemplifies',
] as const
const ConceptMapSchema = z.object({
  title: z.string(),
  nodes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    detail: z.string(),
    type: z.enum(NODE_TYPES),
    importance: z.enum(NODE_IMPORTANCE),
  })),
  relationships: z.array(z.object({
    from: z.string(),
    to: z.string(),
    label: z.enum(RELATIONSHIP_LABELS),
  })),
})

async function getStageContext(stageId: string, topicNames: string[], previousTopicNames: string[] = [], futureTopicNames: string[] = []): Promise<string> {
  // Build a discriminative query that pulls chunks specific to THIS stage's concepts
  // Naming both previous and future topics helps the embedding steer toward stage-specific chunks
  const exclusions = [...previousTopicNames, ...futureTopicNames]
  const query = exclusions.length
    ? `${topicNames.join(', ')} (not about: ${exclusions.join(', ')})`
    : topicNames.join(', ')
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

  // Build full curriculum map so the AI knows the exact scope of THIS stage
  // and what belongs to previous vs future stages
  const { data: allStages } = await supabaseAdmin
    .from('study_stages')
    .select('id, name, stage_order, topic_ids')
    .eq('subject_id', stage.subject_id)
    .order('stage_order')

  const currentOrder: number = stage.stage_order

  // Collect all topic IDs across all stages for a single bulk fetch
  const allTopicIds = [...new Set((allStages ?? []).flatMap((s: any) => s.topic_ids ?? []))]
  let allTopicMap = new Map<string, string>()
  if (allTopicIds.length > 0) {
    const { data: allTopics } = await supabaseAdmin.from('topics').select('id, name').in('id', allTopicIds)
    allTopicMap = new Map((allTopics ?? []).map((t: any) => [t.id, t.name]))
  }

  const previousTopicNames: string[] = []
  const futureTopicNames: string[] = []
  let curriculumContext = ''

  if ((allStages ?? []).length > 1) {
    const lines = (allStages ?? []).map((s: any) => {
      const stageTopicNames = (s.topic_ids ?? []).map((id: string) => allTopicMap.get(id)).filter(Boolean)
      if (s.stage_order < currentOrder) {
        stageTopicNames.forEach((n: string) => previousTopicNames.push(n))
        return `Stage ${s.stage_order} "${s.name}" [ALREADY COVERED]: ${stageTopicNames.join(', ')}`
      } else if (s.stage_order === currentOrder) {
        return `Stage ${s.stage_order} "${s.name}" [CURRENT STAGE]: ${stageTopicNames.join(', ')}`
      } else {
        stageTopicNames.forEach((n: string) => futureTopicNames.push(n))
        return `Stage ${s.stage_order} "${s.name}" [COVERED LATER]: ${stageTopicNames.join(', ')}`
      }
    })
    curriculumContext = lines.join('\n')
  }

  const context = await getStageContext(stage_id, topics?.map(t => t.name) ?? [stage.name], previousTopicNames, futureTopicNames)

  // Build forbidden concept set for programmatic post-filter on keyConcepts
  const forbiddenTerms = new Set(
    [...previousTopicNames, ...futureTopicNames].map(n => n.toLowerCase().trim())
  )
  function isAllowedConcept(term: string): boolean {
    if (!forbiddenTerms.size) return true
    const t = term.toLowerCase().trim()
    return ![...forbiddenTerms].some(f => t.includes(f) || f.includes(t))
  }

  let content: SummaryContent | FlashcardsContent | ConceptMapContent

  if (type === 'summary') {
    // Use gpt-4o for summaries: far better at following strict multi-constraint instructions
    const forbiddenList = [...previousTopicNames, ...futureTopicNames].join(', ')
    const systemMsg = forbiddenList
      ? `You are a curriculum designer writing stage-specific study content. This stage covers ONLY: ${topicNames}. You must NOT define or create concept entries for any of the following — they are covered in other stages: ${forbiddenList}. If these appear in the source material, reference them only as forward/backward context in prose, never as key concept definitions.`
      : 'You are a curriculum designer. Write stage-specific study content for exactly the assigned topics.'
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: PROMPTS.generateSummary(topicNames, examFormat, context, curriculumContext || undefined) },
      ],
      response_format: zodResponseFormat(SummarySchema, 'summary'),
    })
    const parsed = r.choices[0].message.parsed as SummaryContent
    if (parsed && forbiddenTerms.size) {
      parsed.keyConcepts = (parsed.keyConcepts ?? []).filter(kc => isAllowedConcept(kc.term))
    }
    if (parsed) {
      parsed.masteryTerms = (parsed.keyConcepts ?? []).map(kc => kc.term)
    }
    content = parsed

  } else if (type === 'flashcards') {
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate stage-specific flashcards scoped strictly to the current stage\'s concepts. Never test concepts from other stages.' },
        { role: 'user', content: PROMPTS.generateFlashcards(topicNames, examFormat, context, curriculumContext || undefined) },
      ],
      response_format: zodResponseFormat(FlashcardsSchema, 'flashcards'),
    })
    content = r.choices[0].message.parsed as FlashcardsContent

  } else {
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You generate concept maps strictly scoped to the current stage\'s concepts. Exclude all concepts assigned to other stages.' },
        { role: 'user', content: PROMPTS.generateConceptMap(topicNames, context, curriculumContext || undefined) },
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
