import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import type { StageStatus } from '@/types/database'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id: stage_id } = req.query as { id: string }
  const { status } = req.body as { status: StageStatus }

  const validStatuses: StageStatus[] = ['not_started', 'in_progress', 'complete', 'needs_review']
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  const { data: stage } = await supabaseAdmin
    .from('study_stages')
    .select('*, subjects!inner(user_id)')
    .eq('id', stage_id)
    .single()
  if (!stage || (stage as any).subjects.user_id !== user.id) {
    return res.status(404).json({ error: 'Stage not found' })
  }

  const { data, error } = await supabaseAdmin
    .from('study_stages')
    .update({ status })
    .eq('id', stage_id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json(data)
}
