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
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <Spinner className="text-indigo-400 w-5 h-5" />
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <p className="text-red-400">{error || 'Subject not found'}</p>
    </div>
  )

  const { subject, topics, stages, mastery, readiness_history } = data
  const score = readiness_history[0]?.score ?? computeReadinessScore(topics, mastery)
  const nextTask: NextBestTask = computeNextBestTask(stages, topics, mastery, subject.exam_date)
  const days = daysUntil(subject.exam_date)

  const masteryMap = new Map(mastery.map(m => [m.topic_id, m.level]))

  // Quick mastery summary for each stage
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
      <div className="min-h-screen bg-zinc-950 px-4 py-10">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-xs transition">← Dashboard</Link>
              <h1 className="text-xl font-bold text-white mt-1">{subject.name}</h1>
              {days !== null && (
                <p className={cn(
                  'text-sm mt-0.5',
                  days <= 7 ? 'text-red-400' : days <= 14 ? 'text-yellow-400' : 'text-zinc-400'
                )}>
                  {days > 0 ? `Exam in ${days} day${days !== 1 ? 's' : ''}` : 'Exam today!'}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-3xl font-bold text-white tabular-nums">{score}%</p>
              <p className="text-zinc-500 text-xs">ready</p>
            </div>
          </div>

          {/* Next Best Task */}
          <NextBestTaskCard task={nextTask} subjectId={id} />

          {/* Study Path */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Study path</h2>
            <div className="space-y-2">
              {stages.map((stage, i) => {
                const isLocked = stage.status === 'not_started' &&
                  i > 0 && stages[i - 1].status !== 'complete'
                const ml = stageMasteryLevel(stage)

                return (
                  <button
                    key={stage.id}
                    onClick={() => router.push(`/subjects/${id}/stages/${stage.id}`)}
                    className={cn(
                      'w-full text-left rounded-xl border p-4 transition',
                      stage.status === 'in_progress'
                        ? 'border-indigo-500/50 bg-indigo-500/10'
                        : stage.status === 'complete'
                        ? 'border-zinc-700 bg-zinc-900/50 opacity-80'
                        : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                          'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                          stage.status === 'complete' ? 'bg-green-500 text-white' :
                          stage.status === 'in_progress' ? 'bg-indigo-500 text-white' :
                          'bg-zinc-800 text-zinc-400'
                        )}>
                          {stage.status === 'complete' ? '✓' : stage.stage_order}
                        </span>
                        <div className="min-w-0">
                          <p className={cn('font-medium text-sm truncate', stage.status === 'complete' ? 'text-zinc-400' : 'text-white')}>
                            {stage.name}
                          </p>
                          <p className="text-zinc-500 text-xs">~{stage.estimated_minutes} min</p>
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
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Mastery</h2>
                <Link href={`/subjects/${id}/mastery`} className="text-xs text-indigo-400 hover:text-indigo-300 transition">View all →</Link>
              </div>
              <div className="flex flex-wrap gap-2">
                {topics.map(topic => {
                  const level = masteryMap.get(topic.id) ?? 'grey'
                  return (
                    <div
                      key={topic.id}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border',
                        level === 'green' ? 'bg-green-500/15 border-green-500/30 text-green-300' :
                        level === 'yellow' ? 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300' :
                        level === 'red' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
                        'bg-zinc-800 border-zinc-700 text-zinc-400'
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
    not_started: 'text-zinc-500',
    in_progress: 'text-indigo-400',
    complete: 'text-green-400',
    needs_review: 'text-yellow-400',
  }
  const label: Record<string, string> = {
    not_started: 'Not started',
    in_progress: 'In progress',
    complete: 'Complete',
    needs_review: 'Review',
  }
  return <span className={cn('text-xs font-medium', map[status] ?? 'text-zinc-500')}>{label[status] ?? status}</span>
}
