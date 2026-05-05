import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import os from 'os'
import process from 'process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\n/)
    .filter(line => line && !line.trim().startsWith('#'))
    .map(line => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    })
)

const subjectQuery = process.argv.slice(2).join(' ') || 'intro macro 9'
const outDir = path.join(os.tmpdir(), 'fuckexam-study-audit')
fs.mkdirSync(outDir, { recursive: true })

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const STOP = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'because', 'before', 'being', 'below',
  'between', 'chapter', 'concept', 'concepts', 'course', 'define', 'during', 'example', 'figure',
  'first', 'from', 'have', 'into', 'lecture', 'module', 'other', 'should', 'slide', 'stage',
  'summary', 'than', 'that', 'their', 'there', 'these', 'this', 'through', 'under', 'where',
  'which', 'while', 'with', 'would', 'your',
])

function words(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 4 && !STOP.has(word))
}

function similarity(a, b) {
  const aSet = new Set(words(a))
  const bSet = new Set(words(b))
  if (!aSet.size || !bSet.size) return 0
  let overlap = 0
  for (const word of aSet) if (bSet.has(word)) overlap += 1
  return overlap / Math.min(aSet.size, bSet.size)
}

function normalizeText(text) {
  return (text || '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/�/g, '')
    .replace(/\0/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function flattenSummary(content) {
  if (!content) return ''
  const parts = []
  if (content.bigIdea) parts.push(content.bigIdea)
  for (const key of ['quickOverview', 'mustKnow', 'ideaConnections']) {
    if (Array.isArray(content[key])) {
      parts.push(...content[key].map(item => typeof item === 'string' ? item : JSON.stringify(item)))
    }
  }
  if (Array.isArray(content.keyConcepts)) {
    parts.push(...content.keyConcepts.map(item => `${item.term || ''} ${item.definition || ''} ${item.whyItMatters || ''}`))
  }
  if (Array.isArray(content.adaptiveSections)) {
    parts.push(...content.adaptiveSections.map(item => `${item.title || ''} ${item.content || ''} ${(item.items || []).join(' ')}`))
  }
  if (Array.isArray(content.examTraps)) {
    parts.push(...content.examTraps.map(item => `${item.mistake || ''} ${item.fix || ''}`))
  }
  if (Array.isArray(content.quickCheck)) {
    parts.push(...content.quickCheck.map(item => `${item.question || ''} ${item.answer || ''}`))
  }
  if (content.detailedNotes) parts.push(content.detailedNotes)
  return parts.join('\n')
}

function topTerms(text, limit = 80) {
  const counts = new Map()
  for (const word of words(text)) counts.set(word, (counts.get(word) || 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

function sourceSections(text) {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const headings = []
  for (const line of lines) {
    const cleaned = line.replace(/\s+/g, ' ')
    const wordCount = cleaned.split(/\s+/).length
    const looksLikeHeading =
      wordCount <= 12 &&
      cleaned.length >= 4 &&
      /[A-Za-z]/.test(cleaned) &&
      !/[.!?]$/.test(cleaned) &&
      (
        /^[0-9]+(\.[0-9]+)*\s+/.test(cleaned) ||
        /^[A-Z][A-Za-z\s,&()/-]+$/.test(cleaned) ||
        /^(What|Why|How|The|A|An)\s/.test(cleaned)
      )
    if (looksLikeHeading && !headings.includes(cleaned)) headings.push(cleaned)
  }
  return headings.slice(0, 120)
}

async function main() {
  const { data: subjects, error: subjectError } = await supabase
    .from('subjects')
    .select('id,name,created_at')
    .ilike('name', `%${subjectQuery}%`)
    .order('created_at', { ascending: false })
    .limit(5)
  if (subjectError) throw subjectError
  if (!subjects?.length) throw new Error(`No subject found for "${subjectQuery}"`)

  const subject = subjects[0]
  const [{ data: materials, error: materialsError }, { data: stages, error: stagesError }] = await Promise.all([
    supabase
      .from('materials')
      .select('id,file_name,storage_path,material_type,upload_order')
      .eq('subject_id', subject.id)
      .order('upload_order', { ascending: true, nullsFirst: false }),
    supabase
      .from('study_stages')
      .select('id,name,stage_order,status,source_file_name,source_material_id,module_order,key_concepts,prerequisite_concepts,review_concepts')
      .eq('subject_id', subject.id)
      .order('stage_order'),
  ])
  if (materialsError) throw materialsError
  if (stagesError) throw stagesError

  const { data: generated, error: generatedError } = await supabase
    .from('generated_items')
    .select('stage_id,type,content')
    .in('stage_id', stages.map(stage => stage.id))
    .eq('type', 'summary')
  if (generatedError) throw generatedError
  const summaryByStage = new Map((generated || []).map(item => [item.stage_id, item.content]))

  const sourceByMaterial = []
  for (const material of materials) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from('materials')
      .download(material.storage_path)
    if (downloadError || !blob) throw downloadError || new Error(`Could not download ${material.file_name}`)

    const buffer = Buffer.from(await blob.arrayBuffer())
    const rawPath = path.join(outDir, material.file_name.replace(/[^\w.-]+/g, '_'))
    fs.writeFileSync(rawPath, buffer)
    const parsed = await pdfParse(buffer)
    const text = normalizeText(parsed.text)
    const textPath = `${rawPath}.txt`
    fs.writeFileSync(textPath, text)

    const { data: chunks, error: chunksError } = await supabase
      .from('chunks')
      .select('content,metadata')
      .eq('material_id', material.id)
    if (chunksError) throw chunksError

    sourceByMaterial.push({
      material,
      rawPath,
      textPath,
      text,
      chunks: chunks || [],
      headings: sourceSections(text),
      topTerms: topTerms(text),
    })
  }

  const report = []
  report.push(`Subject: ${subject.name} (${subject.id})`)
  report.push(`Source PDFs downloaded/parsing output: ${outDir}`)
  report.push(`Counts: ${materials.length} materials, ${stages.length} stages, ${summaryByStage.size} generated summaries`)
  report.push('')

  report.push('STUDY PATH')
  for (const stage of stages) {
    report.push(`${stage.stage_order}. [M${stage.module_order}] ${stage.name}`)
    report.push(`   file: ${stage.source_file_name}`)
    report.push(`   key_concepts: ${(stage.key_concepts || []).join('; ')}`)
    if ((stage.review_concepts || []).length) report.push(`   review_concepts: ${stage.review_concepts.join('; ')}`)
  }
  report.push('')

  report.push('ADJACENT OVERLAP FLAGS')
  let overlapFlags = 0
  for (let i = 0; i < stages.length - 1; i += 1) {
    const a = stages[i]
    const b = stages[i + 1]
    const pairs = []
    for (const aKey of a.key_concepts || []) {
      for (const bKey of b.key_concepts || []) {
        const score = similarity(aKey, bKey)
        if (score >= 0.45) pairs.push(`${aKey} ~ ${bKey} (${score.toFixed(2)})`)
      }
    }
    const summaryScore = similarity(flattenSummary(summaryByStage.get(a.id)), flattenSummary(summaryByStage.get(b.id)))
    if (pairs.length || summaryScore >= 0.22) {
      overlapFlags += 1
      report.push(`${a.stage_order}->${b.stage_order}: summarySim=${summaryScore.toFixed(2)} ${pairs.length ? `key overlap: ${pairs.join(' | ')}` : ''}`)
    }
  }
  if (!overlapFlags) report.push('No adjacent overlap above threshold.')
  report.push('')

  report.push('GENERATED SUMMARY SECTION EXCERPTS')
  for (const stage of stages) {
    const summary = summaryByStage.get(stage.id) || {}
    report.push(`${stage.stage_order}. ${stage.name}`)
    report.push(`   learn5: ${(summary.quickOverview || []).slice(0, 4).join(' | ')}`)
    report.push(`   bigIdea: ${summary.bigIdea || ''}`)
    report.push(`   mustKnow: ${(summary.mustKnow || []).slice(0, 5).join(' | ')}`)
    report.push(`   keyConceptTerms: ${(summary.keyConcepts || []).map(item => item.term || '').join(' | ')}`)
    report.push(`   adaptive: ${(summary.adaptiveSections || []).map(item => item.title || item.sectionType || '').join(' | ')}`)
    report.push(`   connects: ${(summary.ideaConnections || []).slice(0, 3).join(' | ')}`)
    report.push(`   traps: ${(summary.examTraps || []).map(item => item.mistake || '').slice(0, 3).join(' | ')}`)
    report.push(`   notesStart: ${(summary.detailedNotes || '').slice(0, 320).replace(/\s+/g, ' ')}`)
  }
  report.push('')

  report.push('SOURCE COVERAGE BY ORIGINAL PDF')
  for (const source of sourceByMaterial) {
    const moduleStages = stages.filter(stage => stage.source_material_id === source.material.id)
    const moduleSummary = moduleStages.map(stage => flattenSummary(summaryByStage.get(stage.id))).join('\n')
    const moduleKeys = moduleStages.flatMap(stage => stage.key_concepts || []).join('\n')
    const chunkText = source.chunks.map(chunk => chunk.content).join('\n')
    report.push(`${source.material.upload_order}. ${source.material.file_name}`)
    report.push(`   PDF chars=${source.text.length}; processed chunk chars=${chunkText.length}; stages=${moduleStages.map(stage => stage.stage_order).join(', ')}`)
    report.push(`   source headings/sample checklist: ${source.headings.slice(0, 30).join(' | ')}`)
    report.push(`   top source terms: ${source.topTerms.slice(0, 35).map(item => `${item.term}:${item.count}`).join(', ')}`)

    const paragraphs = source.text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length >= 160)
    const weak = []
    for (let i = 0; i < paragraphs.length; i += 1) {
      const paragraph = paragraphs[i]
      const summaryScore = similarity(paragraph, moduleSummary)
      const keyScore = similarity(paragraph, moduleKeys)
      if (summaryScore < 0.10 && keyScore < 0.10) {
        weak.push({ index: i + 1, summaryScore, keyScore, text: paragraph.slice(0, 360).replace(/\s+/g, ' ') })
      }
    }
    report.push(`   paragraph coverage flags: weak=${weak.length}/${paragraphs.length}`)
    for (const item of weak.slice(0, 10)) {
      report.push(`   weak paragraph ${item.index}: summary=${item.summaryScore.toFixed(2)} key=${item.keyScore.toFixed(2)} :: ${item.text}`)
    }
    report.push('')
  }

  const reportPath = path.join(outDir, 'audit-report.txt')
  fs.writeFileSync(reportPath, report.join('\n'))
  console.log(report.join('\n'))
  console.log(`\nWrote ${reportPath}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
