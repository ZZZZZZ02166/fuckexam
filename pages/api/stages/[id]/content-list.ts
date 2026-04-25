import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id: stage_id } = req.query as { id: string }

  const { data: stage } = await supabaseAdmin
    .from('study_stages')
    .select('*, subjects!inner(user_id)')
    .eq('id', stage_id)
    .single()
  if (!stage || (stage as any).subjects.user_id !== user.id) {
    return res.status(404).json({ error: 'Stage not found' })
  }

  const { data } = await supabaseAdmin
    .from('generated_items')
    .select('*')
    .eq('stage_id', stage_id)
  return res.status(200).json(data ?? [])
}
