import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { RequireAuth } from '@/components/RequireAuth'
import { NextBestTaskCard } from '@/components/NextBestTaskCard'
import { ReadinessBar } from '@/components/ReadinessBar'
import { Spinner } from '@/components/Spinner'
import { apiJson } from '@/lib/apiFetch'
import { computeNextBestTask, computeReadinessScore } from '@/lib/nextBestTask'
import { masteryBg, daysUntil, cn } from '@/lib/utils'
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
  const router = useRouter()
  const { id } = router.query as { id: string }

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
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
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

  return (
    <>
      <Head><title>Mastery — {subject.name} — fuckexam</title></Head>
      <div className="min-h-screen bg-slate-50">
        {/* Nav */}
        <div className="bg-white border-b border-slate-200 px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <Link href={`/subjects/${id}/path`} className="text-slate-400 hover:text-slate-700 text-sm transition">← Study path</Link>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{subject.name}</h1>
              {days !== null && (
                <p className={cn('text-sm mt-0.5', days <= 7 ? 'text-red-600' : days <= 14 ? 'text-yellow-600' : 'text-slate-400')}>
                  {days > 0 ? `Exam in ${days} day${days !== 1 ? 's' : ''}` : 'Exam today!'}
                </p>
              )}
            </div>
          </div>

          {/* Readiness score */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <ReadinessBar score={score} size="lg" />
            <p className="text-slate-400 text-xs mt-3">
              {greenCount} of {attempted} attempted topics solid
              {topics.length - attempted > 0 && ` · ${topics.length - attempted} not yet started`}
            </p>
          </div>

          {/* Next best task */}
          <NextBestTaskCard task={nextTask} subjectId={id} />

          {/* Mastery map */}
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Mastery map</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {topics.map(topic => {
                const level: MasteryLevel = (masteryMap.get(topic.id) as MasteryLevel) ?? 'grey'
                return (
                  <div
                    key={topic.id}
                    className={cn(
                      'rounded-lg border p-3 flex items-center justify-between gap-3',
                      masteryBg(level)
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-slate-900 text-sm font-medium truncate">{topic.name}</p>
                      {topic.description && (
                        <p className="text-slate-500 text-xs truncate mt-0.5">{topic.description}</p>
                      )}
                    </div>
                    <MasteryBadge level={level} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Mastery legend */}
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            {(['green', 'yellow', 'red', 'grey'] as MasteryLevel[]).map(level => (
              <span key={level} className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full', {
                  green: 'bg-green-500',
                  yellow: 'bg-yellow-400',
                  red: 'bg-red-500',
                  grey: 'bg-slate-400',
                }[level])} />
                {{ green: 'Solid', yellow: 'Shaky', red: 'Weak', grey: 'Not started' }[level]}
              </span>
            ))}
          </div>

          {/* Mistake log */}
          {mistakes.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Mistake log</h2>
              <div className="space-y-2">
                {mistakes.slice(0, 5).map((m, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start gap-2">
                      <span className={cn('text-xs mt-0.5 shrink-0', m.score === 'partial' ? 'text-yellow-600' : 'text-red-600')}>
                        {m.score === 'partial' ? '◑' : '✗'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-slate-900 text-sm">{m.question_text}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{m.topic_name}</p>
                        {m.missing_parts?.length > 0 && (
                          <p className="text-slate-500 text-xs mt-1">
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
      </div>
    </>
  )
}

function MasteryBadge({ level }: { level: MasteryLevel }) {
  const config: Record<MasteryLevel, { label: string; cls: string }> = {
    green:  { label: 'Solid',        cls: 'text-green-700 bg-green-100' },
    yellow: { label: 'Shaky',        cls: 'text-yellow-700 bg-yellow-100' },
    red:    { label: 'Weak',         cls: 'text-red-700 bg-red-100' },
    grey:   { label: 'Not started',  cls: 'text-slate-500 bg-slate-100' },
  }
  const { label, cls } = config[level] ?? config.grey
  return (
    <span className={cn('shrink-0 text-xs font-medium rounded-full px-2 py-0.5', cls)}>
      {label}
    </span>
  )
}
