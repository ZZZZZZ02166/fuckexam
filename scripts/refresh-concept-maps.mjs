/**
 * Clears all cached concept maps so they regenerate fresh on next visit.
 * Usage:
 *   node --env-file=.env.local scripts/refresh-concept-maps.mjs
 *   node --env-file=.env.local scripts/refresh-concept-maps.mjs <subject_id>
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)
const subjectId = process.argv[2] || null

async function main() {
  if (subjectId) {
    console.log(`Refreshing concept maps for subject: ${subjectId}`)
  } else {
    console.log('Refreshing ALL concept maps across all subjects...')
  }

  // Get stage IDs to scope deletions
  let stageQuery = supabase.from('study_stages').select('id, name, subject_id')
  if (subjectId) stageQuery = stageQuery.eq('subject_id', subjectId)
  const { data: stages, error: stageErr } = await stageQuery

  if (stageErr) {
    console.error('Failed to fetch stages:', stageErr.message)
    process.exit(1)
  }
  if (!stages?.length) {
    console.log('No stages found.')
    return
  }

  const stageIds = stages.map(s => s.id)
  console.log(`Found ${stages.length} stages.`)

  // Delete concept_map generated items
  const { error: genErr, count: genCount } = await supabase
    .from('generated_items')
    .delete({ count: 'exact' })
    .in('stage_id', stageIds)
    .eq('type', 'concept_map')

  if (genErr) {
    console.error('Failed to delete generated_items:', genErr.message)
    process.exit(1)
  }
  console.log(`Deleted ${genCount ?? '?'} concept_map generated items.`)

  // Delete concept_map context cache entries
  const { error: cacheErr, count: cacheCount } = await supabase
    .from('stage_context_cache')
    .delete({ count: 'exact' })
    .in('stage_id', stageIds)
    .eq('purpose', 'concept_map')

  if (cacheErr) {
    console.error('Failed to delete stage_context_cache:', cacheErr.message)
    process.exit(1)
  }
  console.log(`Deleted ${cacheCount ?? '?'} concept_map context cache entries.`)

  console.log('\nDone. Concept maps will regenerate with the improved pipeline on next visit.')
  if (stages.length <= 20) {
    console.log('\nStages cleared:')
    stages.forEach(s => console.log(`  - ${s.name} (${s.id})`))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
