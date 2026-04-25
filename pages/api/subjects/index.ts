import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('subjects')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json(data)
  }

  if (req.method === 'POST') {
    const { name, exam_date, exam_format_text } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    const { data, error } = await supabaseAdmin
      .from('subjects')
      .insert({ user_id: user.id, name, exam_date: exam_date || null, exam_format_text: exam_format_text || null })
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).end()
}
