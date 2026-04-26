import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { RequireAuth } from '@/components/RequireAuth'
import { Layout } from '@/components/Layout'
import { NextBestTaskCard } from '@/components/NextBestTaskCard'
import { MasteryDot, MasteryChip } from '@/components/MasteryDot'
import { ReadinessBar } from '@/components/ReadinessBar'
import { Spinner } from '@/components/Spinner'
import { apiJson } from '@/lib/apiFetch'
import { computeNextBestTask, computeReadinessScore } from '@/lib/nextBestTask'
import { daysUntil, cn } from '@/lib/utils'
import type { Subject, StudyStage, Topic, MasteryRecord, NextBestTask, MasteryLevel } from '@/types/database'

interface PageData {
  subject: Subject
  topics: Topic[]
  stages: StudyStage[]
  mastery: MasteryRecord[]
  readiness_history: { score: number; computed_at: string }[]
}

interface WrongAnswer {
  question_text: string
  score: 'partial' | 'wrong'
  missing_parts: string[]
  topic_name: string
}

export default function MasteryPage() {
  return <RequireAuth><MasteryView /></RequireAuth>
}

function MasteryView() {
  const { query } = useRouter()
  const id = query.id as string

  const [data, setData] = useState<PageData | null>(null)
  const [mistakes, setMistakes] = useState<WrongAnswer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiJson<PageData>(`/api/subjects/${id}`),
      apiJson<WrongAnswer[]>(`/api/mistakes/${id}`).catch(() => []),
    ]).then(([d, m]) => {
      setData(d)
      setMistakes(m)
    }).finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4FF]">
      <Spinner className="text-blue-500 w-5 h-5" />
    </div>
  )
  if (!data) return null

  const { subject, topics, stages, mastery, readiness_history } = data
  const masteryMap = new Map(mastery.map(m => [m.topic_id, m.level]))
  const score = readiness_history[0]?.score ?? computeReadinessScore(topics, mastery)
  const nextTask: NextBestTask = computeNextBestTask(stages, topics, mastery, subject.exam_date)
  const days = daysUntil(subject.exam_date)
  const greenCount = topics.filter(t => masteryMap.get(t.id) === 'green').length
  const attempted = topics.filter(t => masteryMap.get(t.id) && masteryMap.get(t.id) !== 'grey').length
  const counts = { green: 0, yellow: 0, red: 0, grey: 0 }
  topics.forEach(t => { const l = (masteryMap.get(t.id) ?? 'grey') as MasteryLevel; counts[l]++ })

  return (
    <>
      <Head><title>Mastery — {subject.name} — fuckexam</title></Head>
      <Layout
        backHref={`/subjects/${id}/path`}
        backLabel="Study Path"
        title="Mastery Map"
      >
        <div className="space-y-6">
          {/* Page header */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B] mb-1.5">Mastery map</p>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-[#0F172A]">{subject.name}</h1>
                {days !== null && (
                  <p className={cn('text-sm mt-1 font-medium', days <= 7 ? 'text-red-500' : days <= 14 ? 'text-amber-500' : 'text-[#64748B]')}>
                    Exam {days > 0 ? `in ${days} day${days !== 1 ? 's' : ''}` : 'today'}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {(['green', 'yellow', 'red', 'grey'] as MasteryLevel[]).map(level => (
                  <div key={level} className="flex items-center gap-1.5 text-xs text-[#64748B] font-medium">
                    <MasteryDot level={level} />
                    {{ green: 'Mastered', yellow: 'Shaky', red: 'Weak', grey: 'Not started' }[level]}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Score + breakdown row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 bg-white rounded-2xl border border-[#E2E8F0] p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B] mb-4">Readiness score</p>
              <ReadinessBar score={score} size="lg" />
              <p className="text-[#64748B] text-xs mt-3">
                {greenCount} of {attempted} attempted topics mastered
                {topics.length - attempted > 0 && ` · ${topics.length - attempted} not yet started`}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 flex flex-col justify-center gap-3">
              {(['green', 'yellow', 'red', 'grey'] as MasteryLevel[]).map(level => (
                <div key={level} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#0F172A]">
                    <MasteryDot level={level} />
                    {{ green: 'Mastered', yellow: 'Shaky', red: 'Weak', grey: 'Not started' }[level]}
                  </div>
                  <MasteryChip level={level} />
                </div>
              ))}
            </div>
          </div>

          {/* Next best task */}
          <NextBestTaskCard task={nextTask} subjectId={id} />

          {/* Topic grid */}
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B] mb-4">All topics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {topics.map(topic => {
                const level: MasteryLevel = (masteryMap.get(topic.id) as MasteryLevel) ?? 'grey'
                return (
                  <div
                    key={topic.id}
                    className="bg-white rounded-xl border border-[#E2E8F0] px-4 py-3.5 flex items-center justify-between gap-3 hover:border-blue-200 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <MasteryDot level={level} size="md" />
                      <div className="min-w-0">
                        <p className="text-[#0F172A] text-sm font-bold truncate">{topic.name}</p>
                        {topic.description && (
                          <p className="text-[#64748B] text-xs truncate mt-0.5">{topic.description}</p>
                        )}
                      </div>
                    </div>
                    <MasteryChip level={level} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Mistake log */}
          {mistakes.length > 0 && (
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B] mb-4">Mistake log</h2>
              <div className="space-y-2">
                {mistakes.slice(0, 5).map((m, i) => (
                  <div key={i} className="bg-white rounded-xl border border-[#E2E8F0] px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <span className={cn('text-xs mt-0.5 shrink-0 font-bold', m.score === 'partial' ? 'text-amber-500' : 'text-red-500')}>
                        {m.score === 'partial' ? '◑' : '✗'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[#0F172A] text-sm">{m.question_text}</p>
                        <p className="text-[#94A3B8] text-xs mt-0.5">{m.topic_name}</p>
                        {m.missing_parts?.length > 0 && (
                          <p className="text-[#64748B] text-xs mt-1">
                            Missed: {m.missing_parts.join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Layout>
    </>
  )
}
