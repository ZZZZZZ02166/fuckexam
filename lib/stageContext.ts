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
): Promise<string> {
  const { data: cached } = await supabaseAdmin
    .from('stage_context_cache')
    .select('context_text')
    .eq('stage_id', stageId)
    .single()
  if (cached) {
    console.log('[ai] context cache_hit stage=', stageId)
    return cached.context_text
  }

  console.log('[ai] context cache_miss stage=', stageId)

  const exclusions = [...previousTopicNames, ...futureTopicNames]
  const query = exclusions.length
    ? `${topicNames.join(', ')} (not about: ${exclusions.join(', ')})`
    : topicNames.join(', ')
  const queryEmbedding = await embedText(query)

  const { data: chunks } = await supabaseAdmin.rpc('match_chunks_for_stage', {
    stage_id_input: stageId,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: 8,
  })

  let contextText = ''

  if (chunks?.length) {
    contextText = (chunks as any[]).map((c: any) => c.content).join('\n\n')
  } else {
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
        .limit(8)
      contextText = (fallbackChunks ?? []).map((c: any) => c.content).join('\n\n')
    }
  }

  if (contextText) {
    await supabaseAdmin
      .from('stage_context_cache')
      .upsert({ stage_id: stageId, context_text: contextText }, { onConflict: 'stage_id' })
  }

  return contextText
}
