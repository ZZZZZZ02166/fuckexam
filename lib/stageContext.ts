import { supabaseAdmin } from '@/lib/supabase/server'
import { embedText } from '@/lib/openai'

// Cache assumes the subject's material set does not change after initial upload.
// If materials are re-uploaded or added, this cache will be stale.
// Cache invalidation on material change is out of scope and must be handled in a future PR.
export async function getStageContext(
  stageId: string,
  subjectId: string,
  topicNames: string[],
  previousTopicNames: string[] = [],
  futureTopicNames: string[] = [],
  purpose: 'general' | 'concept_map' = 'general',
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

  const exclusions = [...previousTopicNames, ...futureTopicNames]
  const base = topicNames.join(', ')

  // More topics = more chunks needed to cover all sub-concepts
  const matchCount = purpose === 'concept_map'
    ? Math.min(6 + topicNames.length * 3, 24)
    : Math.min(4 + topicNames.length * 2, 12)

  let contextText = ''

  if (purpose === 'concept_map') {
    // Multi-query retrieval: 5 purpose-specific queries run in parallel for better coverage
    const excl = exclusions.length ? ` (not about: ${exclusions.join(', ')})` : ''
    const queries = [
      `${base}${excl}: core concept definition key idea`,
      `${base}${excl}: problem motivation failure mode why it matters`,
      `${base}${excl}: cause requirement prerequisite condition`,
      `${base}${excl}: solution method mechanism algorithm approach prevent`,
      `${base}${excl}: limitation drawback trap mistake example scenario`,
    ]

    const perQueryCount = Math.min(4 + topicNames.length * 2, 10)
    const embeddings = await Promise.all(queries.map(q => embedText(q)))
    const results = await Promise.all(
      embeddings.map(emb =>
        supabaseAdmin.rpc('match_chunks_for_stage', {
          stage_id_input: stageId,
          query_embedding: JSON.stringify(emb),
          match_count: perQueryCount,
        })
      )
    )

    // Deduplicate by chunk id, keeping highest similarity score per chunk
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
    const query = exclusions.length ? `${base} (not about: ${exclusions.join(', ')})` : base
    const queryEmbedding = await embedText(query)
    const { data: chunks } = await supabaseAdmin.rpc('match_chunks_for_stage', {
      stage_id_input: stageId,
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: matchCount,
    })
    if (chunks?.length) {
      contextText = (chunks as any[]).map((c: any) => c.content).join('\n\n')
    }
  }

  if (!contextText) {
    const { data: materials } = await supabaseAdmin
      .from('materials')
      .select('id')
      .eq('subject_id', subjectId)
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
