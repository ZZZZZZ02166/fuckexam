import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id } = req.query as { id: string }

  // Verify ownership
  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Not found' })

  if (req.method === 'GET') {
    const [{ data: topics }, { data: stages }, { data: mastery }, { data: snapshots }, { data: materials }] =
      await Promise.all([
        supabaseAdmin.from('topics').select('*').eq('subject_id', id).order('display_order'),
        supabaseAdmin.from('study_stages').select('*').eq('subject_id', id).order('stage_order'),
        supabaseAdmin.from('mastery_records').select('*').eq('user_id', user.id),
        supabaseAdmin
          .from('readiness_snapshots')
          .select('*')
          .eq('user_id', user.id)
          .eq('subject_id', id)
          .order('computed_at', { ascending: false })
          .limit(7),
        supabaseAdmin
          .from('materials')
          .select('id, file_name, material_type, created_at, processed_at')
          .eq('subject_id', id)
          .order('created_at'),
      ])

    return res.status(200).json({
      subject,
      topics: topics ?? [],
      stages: stages ?? [],
      mastery: mastery ?? [],
      readiness_history: snapshots ?? [],
      materials: materials ?? [],
    })
  }

  if (req.method === 'PATCH') {
    const { data, error } = await supabaseAdmin
      .from('subjects')
      .update(req.body)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  res.setHeader('Allow', ['GET', 'PATCH'])
  res.status(405).end()
}
