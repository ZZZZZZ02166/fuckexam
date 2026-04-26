import { test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://idnvzdfgkvmakpjuawjs.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkbnZ6ZGZna3ZtYWtwanVhd2pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDM3OTgsImV4cCI6MjA5MjY3OTc5OH0.ZTqhwoTZ7v6K5RElXCQHgRVkPNvL9Xud-40P4UYUHn0'
const SERVICE_KEY = readFileSync('/Users/niooz/fuckexam/.env.local','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)![1]

test('verify stage summaries are distinct', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const anon = createClient(SUPABASE_URL, ANON_KEY)

  const { data: subjects } = await admin.from('subjects').select('id, name, user_id').order('created_at', { ascending: false })
  const subject = subjects?.find(s => s.name.toLowerCase().includes('computer'))!
  const { data: stages } = await admin.from('study_stages').select('id, name, stage_order').eq('subject_id', subject.id).order('stage_order')
  console.log('Stages:', stages?.map(s => s.name).join(' | '))

  const { data: usr } = await admin.auth.admin.getUserById(subject.user_id)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: usr!.user.email! })
  const { data: sess } = await anon.auth.verifyOtp({ token_hash: (link as any).properties.hashed_token, type: 'magiclink' })

  await page.goto('http://localhost:3000')
  await page.evaluate(({ key, val }: any) => localStorage.setItem(key, JSON.stringify(val)), {
    key: 'sb-idnvzdfgkvmakpjuawjs-auth-token',
    val: { access_token: sess!.session!.access_token, refresh_token: sess!.session!.refresh_token, expires_at: sess!.session!.expires_at }
  })

  // Stage 1
  await page.goto(`http://localhost:3000/subjects/${subject.id}/stages/${stages![0].id}`)
  await page.waitForTimeout(30000)
  await page.screenshot({ path: '/tmp/stage1_final.png', fullPage: true })
  console.log('Stage 1 done')

  // Stage 2
  await page.goto(`http://localhost:3000/subjects/${subject.id}/stages/${stages![1].id}`)
  await page.waitForTimeout(30000)
  await page.screenshot({ path: '/tmp/stage2_final.png', fullPage: true })
  console.log('Stage 2 done')

  // Stage 3
  await page.goto(`http://localhost:3000/subjects/${subject.id}/stages/${stages![2].id}`)
  await page.waitForTimeout(30000)
  await page.screenshot({ path: '/tmp/stage3_final.png', fullPage: true })
  console.log('Stage 3 done')
})
