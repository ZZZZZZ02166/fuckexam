import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\n/)
    .filter(line => line && !line.trim().startsWith('#'))
    .map(line => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    })
)

const subjectQuery = process.argv[2] || 'intro macro 9'
const baseUrl = process.argv[3] || 'http://localhost:3000'
const stageOrders = new Set(
  (process.argv[4] || '')
    .split(',')
    .map(item => Number(item.trim()))
    .filter(Number.isFinite)
)
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, anonKey)

async function main() {
  const { data: subjects, error: subjectError } = await admin
    .from('subjects')
    .select('id,name,user_id')
    .ilike('name', `%${subjectQuery}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  if (subjectError) throw subjectError
  const subject = subjects?.[0]
  if (!subject) throw new Error(`No subject found for "${subjectQuery}"`)

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(subject.user_id)
  if (userError) throw userError
  const email = userData.user?.email
  if (!email) throw new Error(`No email for subject owner ${subject.user_id}`)

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkError) throw linkError
  const { data: sessionData, error: sessionError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  })
  if (sessionError) throw sessionError
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Could not create auth session')

  const { data: stages, error: stagesError } = await admin
    .from('study_stages')
    .select('id,name,stage_order')
    .eq('subject_id', subject.id)
    .order('stage_order')
  if (stagesError) throw stagesError

  const targetStages = stageOrders.size
    ? (stages ?? []).filter(stage => stageOrders.has(stage.stage_order))
    : (stages ?? [])

  console.log(`Regenerating ${targetStages.length} summaries for ${subject.name} (${subject.id}) via ${baseUrl}`)

  for (const stage of targetStages) {
    const response = await fetch(`${baseUrl}/api/stages/${stage.id}/content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type: 'summary', force: true }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(`Stage ${stage.stage_order} failed: ${JSON.stringify(body)}`)
    }
    console.log(`Regenerated stage ${stage.stage_order}: ${stage.name}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
