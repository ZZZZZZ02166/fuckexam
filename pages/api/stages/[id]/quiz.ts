import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { getStageContext } from '@/lib/stageContext'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const QuizBundleSchema = z.object({
  mcqs: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()).length(4),
    correct_index: z.number().int().min(0).max(3),
    explanation: z.string(),
  })),
  recalls: z.array(z.object({
    prompt: z.string(),
    ideal_answer: z.string(),
    key_points: z.array(z.string()),
  })),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id: stage_id } = req.query as { id: string }

  const { data: stage } = await supabaseAdmin
    .from('study_stages')
    .select('*, subjects!inner(user_id, exam_format_text)')
    .eq('id', stage_id)
    .single()
  if (!stage || (stage as any).subjects.user_id !== user.id) {
    return res.status(404).json({ error: 'Stage not found' })
  }

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('questions')
      .select('*')
      .eq('stage_id', stage_id)
      .order('created_at')
    return res.status(200).json(data ?? [])
  }

  if (req.method === 'POST') {
    const existing = await supabaseAdmin
      .from('questions')
      .select('id')
      .eq('stage_id', stage_id)
      .limit(1)
    if (existing.data?.length) {
      console.log('[ai] quiz cache_hit stage=', stage_id)
      const { data } = await supabaseAdmin.from('questions').select('*').eq('stage_id', stage_id)
      return res.status(200).json(data)
    }

    const { data: topics } = await supabaseAdmin
      .from('topics')
      .select('*')
      .in('id', stage.topic_ids ?? [])
    const topicNames = topics?.map(t => t.name).join(', ') ?? stage.name
    const examFormat = (stage as any).subjects.exam_format_text ?? 'university written exam'

    const context = await getStageContext(
      stage_id,
      stage.subject_id,
      topics?.map(t => t.name) ?? [stage.name],
    )

    console.log('[ai] quiz bundle model=gpt-4o-mini stage=', stage_id)
    const r = await openai.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Generate exam quiz content: MCQs and one active recall prompt. Use only the provided source material.' },
        { role: 'user', content: PROMPTS.generateQuizBundle(topicNames, examFormat, context) },
      ],
      response_format: zodResponseFormat(QuizBundleSchema, 'quiz_bundle'),
    })
    const mcqs = r.choices[0].message.parsed?.mcqs ?? []
    const recalls = r.choices[0].message.parsed?.recalls ?? []

    const topicIds = topics?.map(t => t.id) ?? []
    const questionRows = [
      ...mcqs.map((q, i) => ({
        stage_id,
        topic_id: topicIds[i % topicIds.length] ?? null,
        type: 'mcq' as const,
        content: q,
      })),
      ...recalls.map((r, i) => ({
        stage_id,
        topic_id: topicIds[i % topicIds.length] ?? null,
        type: 'recall' as const,
        content: r,
      })),
    ]

    const { data: inserted, error } = await supabaseAdmin
      .from('questions')
      .insert(questionRows)
      .select()
    if (error) return res.status(500).json({ error: error.message })

    return res.status(201).json(inserted)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end()
}
