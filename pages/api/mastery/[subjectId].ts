import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { computeReadinessScore } from '@/lib/nextBestTask'
import type { MasteryLevel } from '@/types/database'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { subjectId } = req.query as { subjectId: string }

  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('id')
    .eq('id', subjectId)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Subject not found' })

  if (req.method === 'POST') {
    // Called after completing a quiz session for a stage
    // Body: { stage_id, answers: [{question_id, score}] }
    const { stage_id, answers } = req.body as {
      stage_id: string
      answers: Array<{ question_id: string; topic_id: string | null; score: string }>
    }

    // Group scores by topic
    const topicScores = new Map<string, { correct: number; total: number }>()
    for (const a of answers) {
      if (!a.topic_id) continue
      const existing = topicScores.get(a.topic_id) ?? { correct: 0, total: 0 }
      existing.total++
      if (a.score === 'correct') existing.correct++
      else if (a.score === 'partial') existing.correct += 0.5
      topicScores.set(a.topic_id, existing)
    }

    // Upsert mastery records
    const upsertRows = [...topicScores.entries()].map(([topic_id, { correct, total }]) => {
      const ratio = total > 0 ? correct / total : 0
      let level: MasteryLevel = 'red'
      if (ratio >= 0.8) level = 'green'
      else if (ratio >= 0.5) level = 'yellow'
      return { user_id: user.id, topic_id, level, updated_at: new Date().toISOString() }
    })

    if (upsertRows.length) {
      await supabaseAdmin
        .from('mastery_records')
        .upsert(upsertRows, { onConflict: 'user_id,topic_id' })
    }

    // Mark stage complete
    if (stage_id) {
      await supabaseAdmin
        .from('study_stages')
        .update({ status: 'complete' })
        .eq('id', stage_id)
    }

    // Recompute readiness score
    const { data: topics } = await supabaseAdmin
      .from('topics')
      .select('*')
      .eq('subject_id', subjectId)
    const { data: mastery } = await supabaseAdmin
      .from('mastery_records')
      .select('*')
      .eq('user_id', user.id)
      .in('topic_id', topics?.map(t => t.id) ?? [])

    const score = computeReadinessScore(topics ?? [], mastery ?? [])
    await supabaseAdmin
      .from('readiness_snapshots')
      .insert({ user_id: user.id, subject_id: subjectId, score })

    return res.status(200).json({ score, mastery: mastery ?? [] })
  }

  res.setHeader('Allow', ['POST'])
  res.status(405).end()
}
