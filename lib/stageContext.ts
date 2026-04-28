import { supabaseAdmin } from '@/lib/supabase/server'
import { embedText } from '@/lib/openai'

type ContextPurpose = 'general' | 'concept_map' | 'answer_coach'

// Three-condition rule: same subject (RPC join) + correct material type + semantic relevance.
// Material type sets the filter; vector similarity picks the relevant chunks within that filter.
const MATERIAL_TYPES_FOR_PURPOSE: Record<ContextPurpose, string[]> = {
  general:      ['course_lecture_material', 'tutorial_material'],
  concept_map:  ['course_lecture_material'],
  answer_coach: ['course_lecture_material', 'tutorial_material', 'past_exam_questions', 'exam_solutions_marking_guide'],
}

// Cache assumes the subject's material set does not change after initial upload.
// Cache invalidation on material change is out of scope and must be handled in a future PR.
export async function getStageContext(
  stageId: string,
  subjectId: string,
  topicNames: string[],
  previousTopicNames: string[] = [],
  futureTopicNames: string[] = [],
  purpose: ContextPurpose = 'general',
  stageName?: string,
): Promise<string> {
  const { data: cached } = await supabaseAdmin
    .from('stage_context_cache')
    .select('context_text')
    .eq('stage_id', stageId)
    .eq('purpose', purpose)
    .single()
  if (cached) {
    console.log('[ai] context cache_hit stage=', stageId, 'purpose=', purpose)
    return cached.context_text
  }

  console.log('[ai] context cache_miss stage=', stageId, 'purpose=', purpose)

  const materialTypesFilter = MATERIAL_TYPES_FOR_PURPOSE[purpose]
  const exclusions = [...previousTopicNames, ...futureTopicNames]
  const base = topicNames.join(', ')

  // Build a specific query string: stage name + topic names + purpose
  // This improves semantic similarity by giving the embedding model full context.
  const purposeLabel = purpose === 'answer_coach' ? 'Answer Coach'
    : purpose === 'concept_map' ? 'concept map'
    : 'summary'
  const excl = exclusions.length ? ` (not about: ${exclusions.join(', ')})` : ''
  const baseQuery = [
    stageName ? `Stage: ${stageName}.` : '',
    `Topics: ${base}${excl}.`,
    `Purpose: ${purposeLabel}.`,
  ].filter(Boolean).join(' ')

  const matchCount = purpose === 'concept_map'
    ? Math.min(6 + topicNames.length * 3, 24)
    : Math.min(4 + topicNames.length * 2, 12)

  let contextText = ''

  if (purpose === 'concept_map') {
    const queries = [
      `${baseQuery} Core concept definition key idea.`,
      `${baseQuery} Problem motivation failure mode why it matters.`,
      `${baseQuery} Cause requirement prerequisite condition.`,
      `${baseQuery} Solution method mechanism algorithm approach.`,
      `${baseQuery} Limitation drawback trap mistake example scenario.`,
    ]

    const perQueryCount = Math.min(4 + topicNames.length * 2, 10)
    const embeddings = await Promise.all(queries.map(q => embedText(q)))
    const results = await Promise.all(
      embeddings.map(emb =>
        supabaseAdmin.rpc('match_chunks_for_stage', {
          stage_id_input: stageId,
          query_embedding: JSON.stringify(emb),
          match_count: perQueryCount,
          material_types_filter: materialTypesFilter,
        })
      )
    )

    const bestByChunk = new Map<string, { content: string; similarity: number }>()
    for (const result of results) {
      for (const chunk of (result.data ?? []) as any[]) {
        const existing = bestByChunk.get(chunk.id)
        if (!existing || chunk.similarity > existing.similarity) {
          bestByChunk.set(chunk.id, { content: chunk.content, similarity: chunk.similarity })
        }
      }
    }

    if (bestByChunk.size > 0) {
      const sorted = [...bestByChunk.values()].sort((a, b) => b.similarity - a.similarity)
      contextText = sorted.slice(0, matchCount).map(c => c.content).join('\n\n')
    }
  } else {
    const queryEmbedding = await embedText(baseQuery)
    const { data: chunks } = await supabaseAdmin.rpc('match_chunks_for_stage', {
      stage_id_input: stageId,
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: matchCount,
      material_types_filter: materialTypesFilter,
    })
    if (chunks?.length) {
      contextText = (chunks as any[]).map((c: any) => c.content).join('\n\n')
    }
  }

  if (!contextText) {
    // Fallback: pull from lecture material only, ignoring semantic similarity
    const { data: materials } = await supabaseAdmin
      .from('materials')
      .select('id')
      .eq('subject_id', subjectId)
      .eq('material_type', 'course_lecture_material')
    const materialIds = (materials ?? []).map((m: any) => m.id)
    if (materialIds.length) {
      const { data: fallbackChunks } = await supabaseAdmin
        .from('chunks')
        .select('content')
        .in('material_id', materialIds)
        .limit(matchCount)
      contextText = (fallbackChunks ?? []).map((c: any) => c.content).join('\n\n')
    }
  }

  if (contextText) {
    await supabaseAdmin
      .from('stage_context_cache')
      .upsert(
        { stage_id: stageId, purpose, context_text: contextText },
        { onConflict: 'stage_id,purpose' },
      )
  }

  return contextText
}
