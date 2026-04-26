import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { RequireAuth } from '@/components/RequireAuth'
import { NextBestTaskCard } from '@/components/NextBestTaskCard'
import { MasteryDot } from '@/components/MasteryDot'
import { ReadinessBar } from '@/components/ReadinessBar'
import { Spinner } from '@/components/Spinner'
import { apiJson } from '@/lib/apiFetch'
import { computeNextBestTask, computeReadinessScore } from '@/lib/nextBestTask'
import { daysUntil, cn } from '@/lib/utils'
import type { Subject, StudyStage, Topic, MasteryRecord, NextBestTask } from '@/types/database'

interface SubjectData {
  subject: Subject
  topics: Topic[]
  stages: StudyStage[]
  mastery: MasteryRecord[]
  readiness_history: { score: number; computed_at: string }[]
}

export default function PathPage() {
  return (
    <RequireAuth>
      <PathView />
    </RequireAuth>
  )
}

function PathView() {
  const router = useRouter()
  const { id } = router.query as { id: string }
  const [data, setData] = useState<SubjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    apiJson<SubjectData>(`/api/subjects/${id}`)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Spinner className="text-blue-500 w-5 h-5" />
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <p className="text-red-600">{error || 'Subject not found'}</p>
    </div>
  )

  const { subject, topics, stages, mastery, readiness_history } = data
  const score = readiness_history[0]?.score ?? computeReadinessScore(topics, mastery)
  const nextTask: NextBestTask = computeNextBestTask(stages, topics, mastery, subject.exam_date)
  const days = daysUntil(subject.exam_date)

  const masteryMap = new Map(mastery.map(m => [m.topic_id, m.level]))

  function stageMasteryLevel(stage: StudyStage) {
    if (!stage.topic_ids?.length) return 'grey'
    const levels = stage.topic_ids.map(tid => masteryMap.get(tid) ?? 'grey')
    if (levels.every(l => l === 'green')) return 'green'
    if (levels.some(l => l === 'red')) return 'red'
    if (levels.some(l => l === 'yellow')) return 'yellow'
    if (levels.some(l => l !== 'grey')) return 'yellow'
    return 'grey'
  }

  return (
    <>
      <Head><title>{subject.name} — fuckexam</title></Head>
      <div className="min-h-screen bg-slate-50">
        {/* Nav */}
        <div className="bg-white border-b border-slate-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <Link href="/" className="text-slate-400 hover:text-slate-700 text-sm transition">← Dashboard</Link>
            <Link href={`/subjects/${id}/mastery`} className="text-sm text-blue-600 hover:text-blue-700 font-medium transition">Mastery →</Link>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{subject.name}</h1>
              {days !== null && (
                <p className={cn(
                  'text-sm mt-0.5',
                  days <= 7 ? 'text-red-600' : days <= 14 ? 'text-yellow-600' : 'text-slate-400'
                )}>
                  {days > 0 ? `Exam in ${days} day${days !== 1 ? 's' : ''}` : 'Exam today!'}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{score}%</p>
              <p className="text-slate-400 text-xs">ready</p>
            </div>
          </div>

          {/* Next Best Task */}
          <NextBestTaskCard task={nextTask} subjectId={id} />

          {/* Study Path */}
          <div>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Study path</h2>
            <div className="space-y-2">
              {stages.map((stage, i) => {
                const ml = stageMasteryLevel(stage)

                return (
                  <button
                    key={stage.id}
                    onClick={() => router.push(`/subjects/${id}/stages/${stage.id}`)}
                    className={cn(
                      'w-full text-left rounded-xl border p-4 transition',
                      stage.status === 'in_progress'
                        ? 'border-blue-300 bg-blue-50'
                        : stage.status === 'complete'
                        ? 'border-slate-200 bg-slate-50 opacity-80'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm shadow-sm'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                          'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                          stage.status === 'complete' ? 'bg-green-500 text-white' :
                          stage.status === 'in_progress' ? 'bg-blue-500 text-white' :
                          'bg-slate-100 text-slate-400'
                        )}>
                          {stage.status === 'complete' ? '✓' : stage.stage_order}
                        </span>
                        <div className="min-w-0">
                          <p className={cn('font-medium text-sm truncate', stage.status === 'complete' ? 'text-slate-400' : 'text-slate-900')}>
                            {stage.name}
                          </p>
                          <p className="text-slate-400 text-xs">~{stage.estimated_minutes} min</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <MasteryDot level={ml as any} />
                        <StatusChip status={stage.status ?? 'not_started'} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Mastery quick view */}
          {topics.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Mastery</h2>
                <Link href={`/subjects/${id}/mastery`} className="text-xs text-blue-600 hover:text-blue-700 transition">View all →</Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {topics.map(topic => {
                  const level = masteryMap.get(topic.id) ?? 'grey'
                  return (
                    <div
                      key={topic.id}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border',
                        level === 'green' ? 'bg-green-50 border-green-200 text-green-700' :
                        level === 'yellow' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' :
                        level === 'red' ? 'bg-red-50 border-red-200 text-red-700' :
                        'bg-slate-100 border-slate-200 text-slate-500'
                      )}
                    >
                      <MasteryDot level={level as any} />
                      {topic.name}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    not_started: 'text-slate-400',
    in_progress: 'text-blue-600',
    complete: 'text-green-600',
    needs_review: 'text-yellow-600',
  }
  const label: Record<string, string> = {
    not_started: 'Not started',
    in_progress: 'In progress',
    complete: 'Complete',
    needs_review: 'Review',
  }
  return <span className={cn('text-xs font-medium', map[status] ?? 'text-slate-400')}>{label[status] ?? status}</span>
}
