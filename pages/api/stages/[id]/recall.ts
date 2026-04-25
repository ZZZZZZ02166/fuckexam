import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { RecallContent } from '@/types/database'

const BodySchema = z.object({
  question_id: z.string().uuid(),
  answer_text: z.string().min(1),
})

const ScoreSchema = z.object({
  score: z.enum(['correct', 'partial', 'wrong']),
  correct_parts: z.array(z.string()),
  missing_parts: z.array(z.string()),
  source_quote: z.string(),
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { question_id, answer_text } = parsed.data

  const { data: question } = await supabaseAdmin
    .from('questions')
    .select('*, study_stages!inner(subject_id, subjects!inner(user_id))')
    .eq('id', question_id)
    .single()
  if (!question) return res.status(404).json({ error: 'Question not found' })
  if ((question as any).study_stages.subjects.user_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const recallContent = question.content as unknown as RecallContent

  // Score via GPT-4o-mini
  const scoreResponse = await openai.chat.completions.parse({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You grade student recall answers fairly but rigorously.' },
      {
        role: 'user',
        content: PROMPTS.scoreRecall(
          recallContent.prompt,
          recallContent.key_points,
          answer_text,
          recallContent.ideal_answer
        )
      },
    ],
    response_format: zodResponseFormat(ScoreSchema, 'score'),
  })

  const feedback = scoreResponse.choices[0].message.parsed!

  // Save the answer
  const { data: answer, error } = await supabaseAdmin
    .from('student_answers')
    .insert({
      user_id: user.id,
      question_id,
      answer_text,
      score: feedback.score,
      feedback: {
        correct_parts: feedback.correct_parts,
        missing_parts: feedback.missing_parts,
        source_quote: feedback.source_quote,
      },
    })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ answer, feedback })
}
