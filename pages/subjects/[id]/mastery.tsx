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
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <Spinner className="text-indigo-400 w-5 h-5" />
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
      <div className="min-h-screen bg-zinc-950 px-4 py-10">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Link href={`/subjects/${id}/path`} className="text-zinc-500 hover:text-zinc-300 text-xs transition">← Study path</Link>
              <h1 className="text-xl font-bold text-white mt-1">{subject.name}</h1>
              {days !== null && (
                <p className={cn('text-sm mt-0.5', days <= 7 ? 'text-red-400' : days <= 14 ? 'text-yellow-400' : 'text-zinc-400')}>
                  {days > 0 ? `Exam in ${days} day${days !== 1 ? 's' : ''}` : 'Exam today!'}
                </p>
              )}
            </div>
          </div>

          {/* Readiness score */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <ReadinessBar score={score} size="lg" />
            <p className="text-zinc-500 text-xs mt-3">
              {greenCount} of {attempted} attempted topics solid
              {topics.length - attempted > 0 && ` · ${topics.length - attempted} not yet started`}
            </p>
          </div>

          {/* Next best task */}
          <NextBestTaskCard task={nextTask} subjectId={id} />

          {/* Mastery map */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Mastery map</h2>
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
                      <p className="text-white text-sm font-medium truncate">{topic.name}</p>
                      {topic.description && (
                        <p className="text-zinc-500 text-xs truncate mt-0.5">{topic.description}</p>
                      )}
                    </div>
                    <MasteryBadge level={level} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Mastery legend */}
          <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
            {(['green', 'yellow', 'red', 'grey'] as MasteryLevel[]).map(level => (
              <span key={level} className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full', {
                  green: 'bg-green-500',
                  yellow: 'bg-yellow-400',
                  red: 'bg-red-500',
                  grey: 'bg-zinc-600',
                }[level])} />
                {{ green: 'Solid', yellow: 'Shaky', red: 'Weak', grey: 'Not started' }[level]}
              </span>
            ))}
          </div>

          {/* Mistake log */}
          {mistakes.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Mistake log</h2>
              <div className="space-y-2">
                {mistakes.slice(0, 5).map((m, i) => (
                  <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                    <div className="flex items-start gap-2">
                      <span className={cn('text-xs mt-0.5 shrink-0', m.score === 'partial' ? 'text-yellow-400' : 'text-red-400')}>
                        {m.score === 'partial' ? '◑' : '✗'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-white text-sm">{m.question_text}</p>
                        <p className="text-zinc-500 text-xs mt-0.5">{m.topic_name}</p>
                        {m.missing_parts?.length > 0 && (
                          <p className="text-zinc-400 text-xs mt-1">
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
    green:  { label: 'Solid',        cls: 'text-green-400 bg-green-500/20' },
    yellow: { label: 'Shaky',        cls: 'text-yellow-400 bg-yellow-500/20' },
    red:    { label: 'Weak',         cls: 'text-red-400 bg-red-500/20' },
    grey:   { label: 'Not started',  cls: 'text-zinc-500 bg-zinc-700/50' },
  }
  const { label, cls } = config[level] ?? config.grey
  return (
    <span className={cn('shrink-0 text-xs font-medium rounded-full px-2 py-0.5', cls)}>
      {label}
    </span>
  )
}
