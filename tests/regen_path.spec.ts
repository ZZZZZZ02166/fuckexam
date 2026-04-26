import { test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = 'https://idnvzdfgkvmakpjuawjs.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkbnZ6ZGZna3ZtYWtwanVhd2pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDM3OTgsImV4cCI6MjA5MjY3OTc5OH0.ZTqhwoTZ7v6K5RElXCQHgRVkPNvL9Xud-40P4UYUHn0'
const SERVICE_KEY = readFileSync('/Users/niooz/fuckexam/.env.local','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)![1]

test('regenerate path and screenshot', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  const anon = createClient(SUPABASE_URL, ANON_KEY)

  // Get the most recently active subject with topics
  const { data: subjects } = await admin.from('subjects').select('id, name, user_id').order('created_at', { ascending: false })
  const subject = subjects?.find(s => s.name.toLowerCase().includes('computer'))
  if (!subject) throw new Error('No computer system subject found')
  console.log('Subject:', subject.name, subject.id)

  // Auth
  const { data: usr } = await admin.auth.admin.getUserById(subject.user_id)
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: usr!.user.email! })
  const { data: sess } = await anon.auth.verifyOtp({ token_hash: (link as any).properties.hashed_token, type: 'magiclink' })
  const token = sess!.session!.access_token

  // Call generate-path API
  console.log('Regenerating study path...')
  const pathRes = await fetch('http://localhost:3000/api/generate-path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ subject_id: subject.id }),
  })
  const pathData = await pathRes.json()
  if (!pathRes.ok) throw new Error('Path gen failed: ' + JSON.stringify(pathData))
  console.log('New stages:')
  pathData.stages.forEach((s: any, i: number) => console.log(`  ${i+1}. "${s.name}" — topics: ${s.topic_ids?.length ?? 0}`))

  // Inject session into browser
  await page.goto('http://localhost:3000')
  await page.evaluate(({ key, val }: any) => localStorage.setItem(key, JSON.stringify(val)), {
    key: 'sb-idnvzdfgkvmakpjuawjs-auth-token',
    val: { access_token: sess!.session!.access_token, refresh_token: sess!.session!.refresh_token, expires_at: sess!.session!.expires_at }
  })

  // Screenshot study path page
  await page.goto(`http://localhost:3000/subjects/${subject.id}/path`)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/new_path.png', fullPage: true })
  console.log('Path page screenshot taken')

  // Enter first stage and wait for summary to generate
  const firstStage = pathData.stages[0]
  await page.goto(`http://localhost:3000/subjects/${subject.id}/stages/${firstStage.id}`)
  await page.waitForTimeout(25000) // wait for AI generation
  await page.screenshot({ path: '/tmp/new_stage1_summary.png', fullPage: true })
  console.log('Stage 1 summary screenshot taken')

  // Enter second stage and wait for summary
  const secondStage = pathData.stages[1]
  if (secondStage) {
    await page.goto(`http://localhost:3000/subjects/${subject.id}/stages/${secondStage.id}`)
    await page.waitForTimeout(25000)
    await page.screenshot({ path: '/tmp/new_stage2_summary.png', fullPage: true })
    console.log('Stage 2 summary screenshot taken')
  }
})
