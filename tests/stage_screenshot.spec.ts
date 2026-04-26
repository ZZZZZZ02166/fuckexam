import { test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://idnvzdfgkvmakpjuawjs.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkbnZ6ZGZna3ZtYWtwanVhd2pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDM3OTgsImV4cCI6MjA5MjY3OTc5OH0.ZTqhwoTZ7v6K5RElXCQHgRVkPNvL9Xud-40P4UYUHn0'
const SERVICE_KEY = readFileSync('/Users/niooz/fuckexam/.env.local','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)![1]

test('stage page screenshot', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const anon = createClient(SUPABASE_URL, ANON_KEY)

  const { data: stages } = await admin.from('study_stages').select('id, subject_id, name').limit(1)
  const stage = stages![0]
  console.log('Stage:', stage.name)

  const { data: subj } = await admin.from('subjects').select('user_id').eq('id', stage.subject_id).single()
  const { data: usr } = await admin.auth.admin.getUserById(subj!.user_id)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: usr!.user.email! })
  const { data: sess } = await anon.auth.verifyOtp({ token_hash: (link as any).properties.hashed_token, type: 'magiclink' })
  const session = sess!.session!

  await page.goto('http://localhost:3000')
  await page.evaluate(({ key, val }: any) => {
    localStorage.setItem(key, JSON.stringify(val))
  }, { key: 'sb-idnvzdfgkvmakpjuawjs-auth-token', val: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at } })

  await page.goto(`http://localhost:3000/subjects/${stage.subject_id}/stages/${stage.id}`)
  await page.waitForTimeout(22000)
  await page.screenshot({ path: '/tmp/stage_summary_loaded.png', fullPage: true })

  await page.click('button:has-text("Map")')
  await page.waitForTimeout(18000)
  await page.screenshot({ path: '/tmp/stage_map_loaded.png', fullPage: true })
})
