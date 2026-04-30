import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { embedText } from '@/lib/openai'
import { chunkText, TextChunk } from '@/lib/chunker'

const EMBED_BATCH = 20

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).end()
  }

  const user = await getUserFromRequest(req.headers.authorization)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { id: material_id } = req.query as { id: string }

  const { data: material } = await supabaseAdmin
    .from('materials')
    .select('id, storage_path, file_name, material_type, subject_id, subjects!inner(user_id)')
    .eq('id', material_id)
    .single()

  if (!material) return res.status(404).json({ error: 'Material not found' })

  const subject = (material as any).subjects
  if (!subject || subject.user_id !== user.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage
    .from('materials')
    .download(material.storage_path)
  if (downloadErr || !fileBlob) {
    return res.status(500).json({ error: 'Could not download file' })
  }

  let fullText = ''
  try {
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const buffer = Buffer.from(await fileBlob.arrayBuffer())
    const result = await pdfParse(buffer)
    fullText = result.text
      .replace(/[\uD800-\uDFFF]/g, '')
      .replace(/�/g, '')
      .replace(/\0/g, '')
  } catch {
    return res.status(500).json({ error: 'Failed to parse PDF' })
  }

  if (!fullText.trim()) {
    return res.status(400).json({ error: 'No text extracted' })
  }

  const chunks = chunkText(fullText)
  if (chunks.length === 0) {
    return res.status(400).json({ error: 'No content chunks produced from file' })
  }

  type EmbeddedChunk = TextChunk & { embedding: number[] }
  const chunksWithEmbeddings: EmbeddedChunk[] = []
  try {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)
      const embedded = await Promise.all(
        batch.map(async chunk => ({ ...chunk, embedding: await embedText(chunk.content) }))
      )
      chunksWithEmbeddings.push(...embedded)
    }
  } catch (err) {
    return res.status(502).json({ error: 'Embedding failed: ' + (err as Error).message })
  }

  // All risky work done — now replace chunks
  await supabaseAdmin.from('chunks').delete().eq('material_id', material_id)

  const { error: chunksErr } = await supabaseAdmin.from('chunks').insert(
    chunksWithEmbeddings.map(c => ({
      material_id,
      content: c.content,
      embedding: JSON.stringify(c.embedding),
      metadata: c.metadata,
      material_type: material.material_type,
    }))
  )
  if (chunksErr) return res.status(500).json({ error: chunksErr.message })

  await supabaseAdmin
    .from('materials')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', material_id)

  return res.status(200).json({ material_id, chunks_count: chunks.length })
}
