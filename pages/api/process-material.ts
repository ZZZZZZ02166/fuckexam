import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai, embedText } from '@/lib/openai'
import { chunkText } from '@/lib/chunker'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const BodySchema = z.object({
  subject_id: z.string().uuid(),
  storage_path: z.string(),
  file_name: z.string(),
})

const TopicsSchema = z.object({
  topics: z.array(z.object({
    name: z.string(),
    description: z.string(),
    weight: z.number().min(0).max(1),
  }))
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

  const { subject_id, storage_path, file_name } = parsed.data

  // Verify ownership
  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('id')
    .eq('id', subject_id)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Subject not found' })

  // Record the material row
  const { data: material, error: materialErr } = await supabaseAdmin
    .from('materials')
    .insert({ subject_id, file_name, storage_path })
    .select()
    .single()
  if (materialErr) return res.status(500).json({ error: materialErr.message })

  // Download file from Supabase Storage
  const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage
    .from('materials')
    .download(storage_path)
  if (downloadErr || !fileBlob) {
    return res.status(500).json({ error: 'Could not download uploaded file' })
  }

  // Parse PDF text
  let fullText = ''
  try {
    // Dynamic import to avoid SSR issues
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
    const buffer = Buffer.from(await fileBlob.arrayBuffer())
    const parsed = await pdfParse(buffer)
    fullText = parsed.text
  } catch {
    return res.status(500).json({ error: 'Failed to parse PDF' })
  }

  if (!fullText.trim()) {
    return res.status(400).json({ error: 'No text could be extracted from file' })
  }

  // Chunk + embed
  const chunks = chunkText(fullText)
  const embedPromises = chunks.map(async (chunk) => {
    const embedding = await embedText(chunk.content)
    return { ...chunk, embedding }
  })
  const chunksWithEmbeddings = await Promise.all(embedPromises)

  // Batch insert chunks
  const chunkRows = chunksWithEmbeddings.map(c => ({
    material_id: material.id,
    content: c.content,
    embedding: JSON.stringify(c.embedding),
    metadata: c.metadata,
  }))

  const { error: chunksErr } = await supabaseAdmin.from('chunks').insert(chunkRows)
  if (chunksErr) return res.status(500).json({ error: chunksErr.message })

  // Extract topics via GPT-4o
  const topicResponse = await openai.chat.completions.parse({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You extract topics from university course materials for exam preparation.' },
      { role: 'user', content: PROMPTS.extractTopics(fullText) },
    ],
    response_format: zodResponseFormat(TopicsSchema, 'topics'),
  })

  const extractedTopics = topicResponse.choices[0].message.parsed?.topics ?? []

  // Check if topics already exist for this subject, delete and recreate
  await supabaseAdmin.from('topics').delete().eq('subject_id', subject_id)

  const topicRows = extractedTopics.map((t, i) => ({
    subject_id,
    name: t.name,
    description: t.description,
    weight: t.weight,
    display_order: i,
  }))

  const { data: topicsInserted, error: topicsErr } = await supabaseAdmin
    .from('topics')
    .insert(topicRows)
    .select()
  if (topicsErr) return res.status(500).json({ error: topicsErr.message })

  // Mark material as processed
  await supabaseAdmin
    .from('materials')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', material.id)

  return res.status(200).json({
    material_id: material.id,
    chunks_count: chunks.length,
    topics: topicsInserted,
  })
}
