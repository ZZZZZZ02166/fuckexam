import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import type { RecallContent, MCQContent } from '@/types/database'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { subjectId } = req.query as { subjectId: string }

  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('id')
    .eq('id', subjectId)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Not found' })

  // Get wrong/partial answers for questions in this subject's stages
  const { data: answers } = await supabaseAdmin
    .from('student_answers')
    .select(`
      score,
      feedback,
      questions (
        type,
        content,
        topic_id,
        topics ( name )
      )
    `)
    .eq('user_id', user.id)
    .in('score', ['wrong', 'partial'])
    .order('answered_at', { ascending: false })
    .limit(20)

  if (!answers) return res.status(200).json([])

  // Filter to this subject's questions (via topics)
  const { data: subjectTopics } = await supabaseAdmin
    .from('topics')
    .select('id')
    .eq('subject_id', subjectId)
  const topicIds = new Set(subjectTopics?.map(t => t.id) ?? [])

  const mistakes = answers
    .filter(a => {
      const q = (a as any).questions
      return q && topicIds.has(q.topic_id)
    })
    .map(a => {
      const q = (a as any).questions
      const question_text = q.type === 'recall'
        ? (q.content as RecallContent).prompt
        : (q.content as MCQContent).question
      return {
        question_text,
        score: a.score,
        missing_parts: (a.feedback as any)?.missing_parts ?? [],
        topic_name: (q.topics as any)?.name ?? '',
      }
    })

  return res.status(200).json(mistakes)
}
