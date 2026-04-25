import type { NextApiRequest, NextApiResponse } from 'next'
import { supabaseAdmin, getUserFromRequest } from '@/lib/supabase/server'
import { openai } from '@/lib/openai'
import { PROMPTS } from '@/lib/prompts'
import { z } from 'zod'
import { zodResponseFormat } from 'openai/helpers/zod'

const BodySchema = z.object({ subject_id: z.string().uuid() })

const PathSchema = z.object({
  stages: z.array(z.object({
    name: z.string(),
    topic_names: z.array(z.string()),
    estimated_minutes: z.number().int().min(10).max(120),
    material_types: z.array(z.enum(['summary', 'flashcards', 'concept_map'])),
    test_types: z.array(z.enum(['recall', 'mcq'])),
    rationale: z.string().optional(),
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

  const { subject_id } = parsed.data

  const { data: subject } = await supabaseAdmin
    .from('subjects')
    .select('*')
    .eq('id', subject_id)
    .eq('user_id', user.id)
    .single()
  if (!subject) return res.status(404).json({ error: 'Subject not found' })

  const { data: topics } = await supabaseAdmin
    .from('topics')
    .select('*')
    .eq('subject_id', subject_id)
    .order('display_order')
  if (!topics?.length) return res.status(400).json({ error: 'No topics found — process a material first' })

  // Delete existing stages before regenerating
  await supabaseAdmin.from('study_stages').delete().eq('subject_id', subject_id)

  const pathResponse = await openai.chat.completions.parse({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You design study paths for university students preparing for exams.' },
      {
        role: 'user',
        content: PROMPTS.generatePath(
          JSON.stringify(topics.map(t => ({ name: t.name, description: t.description, weight: t.weight }))),
          subject.exam_format_text ?? 'University written exam'
        )
      },
    ],
    response_format: zodResponseFormat(PathSchema, 'path'),
  })

  const generatedStages = pathResponse.choices[0].message.parsed?.stages ?? []

  // Map topic names back to IDs
  const topicNameToId = new Map(topics.map(t => [t.name.toLowerCase(), t.id]))

  const stageRows = generatedStages.map((stage, i) => {
    const topic_ids = stage.topic_names
      .map(name => {
        // fuzzy match: find closest topic
        const exact = topicNameToId.get(name.toLowerCase())
        if (exact) return exact
        const partial = [...topicNameToId.entries()].find(([k]) =>
          k.includes(name.toLowerCase()) || name.toLowerCase().includes(k)
        )
        return partial?.[1] ?? null
      })
      .filter(Boolean) as string[]

    return {
      subject_id,
      name: stage.name,
      topic_ids,
      stage_order: i + 1,
      estimated_minutes: stage.estimated_minutes,
      status: 'not_started' as const,
      material_types: stage.material_types,
      test_types: stage.test_types,
    }
  })

  const { data: stages, error } = await supabaseAdmin
    .from('study_stages')
    .insert(stageRows)
    .select()
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ stages })
}
