import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { embedText } from '@/lib/openai'
import { chunkText } from '@/lib/chunker'
import { z } from 'zod'

const BodySchema = z.object({
  subject_id: z.string().uuid(),
  storage_path: z.string(),
  file_name: z.string(),
  material_type: z.enum([
    'course_lecture_material',
    'tutorial_material',
    'past_exam_questions',
    'exam_solutions_marking_guide',
  ]).default('course_lecture_material'),
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

  const { subject_id, storage_path, file_name, material_type } = parsed.data

  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('id, name, exam_format_text')
    .eq('id', subject_id)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Subject not found' })

  const { data: material, error: materialErr } = await supabaseAdmin
    .from('materials')
    .insert({ subject_id, file_name, storage_path, material_type })
    .select()
    .single()
  if (materialErr) return res.status(500).json({ error: materialErr.message })

  const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage
    .from('materials')
    .download(storage_path)
  if (downloadErr || !fileBlob) {
    return res.status(500).json({ error: 'Could not download uploaded file' })
  }

  let fullText = ''
  try {
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const buffer = Buffer.from(await fileBlob.arrayBuffer())
    const result = await pdfParse(buffer)
    fullText = result.text
    // Strip lone surrogates and other invalid Unicode that breaks JSON serialization
    fullText = fullText
      .replace(/[\uD800-\uDFFF]/g, '')
      .replace(/�/g, '')
  } catch {
    return res.status(500).json({ error: 'Failed to parse PDF' })
  }

  if (!fullText.trim()) {
    return res.status(400).json({ error: 'No text could be extracted from file' })
  }

  const chunks = chunkText(fullText)
  const chunksWithEmbeddings = await Promise.all(
    chunks.map(async chunk => ({ ...chunk, embedding: await embedText(chunk.content) }))
  )

  const { error: chunksErr } = await supabaseAdmin.from('chunks').insert(
    chunksWithEmbeddings.map(c => ({
      material_id: material.id,
      content: c.content,
      embedding: JSON.stringify(c.embedding),
      metadata: c.metadata,
      material_type,
    }))
  )
  if (chunksErr) return res.status(500).json({ error: chunksErr.message })

  await supabaseAdmin
    .from('materials')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', material.id)

  return res.status(200).json({ material_id: material.id, chunks_count: chunks.length })
}
