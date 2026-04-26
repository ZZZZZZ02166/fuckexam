import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { RequireAuth } from '@/components/RequireAuth'
import { Layout } from '@/components/Layout'
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
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4FF]">
      <Spinner className="text-blue-500 w-5 h-5" />
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4FF]">
      <p className="text-red-500">{error || 'Subject not found'}</p>
    </div>
  )

  const { subject, topics, stages, mastery, readiness_history } = data
  const score = readiness_history[0]?.score ?? computeReadinessScore(topics, mastery)
  const nextTask: NextBestTask = computeNextBestTask(stages, topics, mastery, subject.exam_date)
  const days = daysUntil(subject.exam_date)
  const masteryMap = new Map(mastery.map(m => [m.topic_id, m.level]))
  const stagesComplete = stages.filter(s => s.status === 'complete').length

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
      <Layout
        backHref="/"
        backLabel="Dashboard"
        title="Study Path"
        actions={
          <Link
            href={`/subjects/${id}/mastery`}
            className="text-sm font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-xl transition"
          >
            Mastery map →
          </Link>
        }
      >
        <div className="space-y-6">
          {/* Page header */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B] mb-1.5">Study path</p>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold text-[#0F172A] leading-tight">{subject.name}</h1>
                {days !== null && (
                  <p className={cn('text-sm mt-1 font-medium', days <= 7 ? 'text-red-500' : days <= 14 ? 'text-amber-500' : 'text-[#64748B]')}>
                    Exam {days > 0 ? `in ${days} day${days !== 1 ? 's' : ''}` : 'today'}{subject.exam_date && ` · ${new Date(subject.exam_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className={cn(
                  'text-4xl font-extrabold tabular-nums leading-none',
                  score >= 70 ? 'text-green-600' : score >= 40 ? 'text-amber-500' : 'text-[#0F172A]'
                )}>
                  {score}<span className="text-lg font-bold">%</span>
                </p>
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#64748B] mt-1">Readiness</p>
              </div>
            </div>
          </div>

          {/* Progress card */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] px-5 py-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#64748B] uppercase tracking-[0.1em]">Progress</span>
              <span className="font-bold text-[#0F172A]">{stagesComplete} / {stages.length} stages complete</span>
            </div>
            <ReadinessBar score={score} showLabel={false} />
            <div className="flex gap-1 pt-0.5">
              {stages.map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-all',
                    s.status === 'complete'    ? 'bg-green-500' :
                    s.status === 'in_progress' ? 'bg-blue-500' :
                    'bg-[#E2E8F0]'
                  )}
                />
              ))}
            </div>
          </div>

          {/* Next best task */}
          <NextBestTaskCard task={nextTask} subjectId={id} />

          {/* Stage list */}
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B] mb-4">Study stages</h2>
            <div className="space-y-0">
              {stages.map((stage, index) => {
                const ml = stageMasteryLevel(stage)
                const isComplete = stage.status === 'complete'
                const isActive = stage.status === 'in_progress'

                return (
                  <div key={stage.id} className="flex gap-3 sm:gap-4">
                    {/* Badge + connector */}
                    <div className="flex flex-col items-center w-9 sm:w-10 shrink-0">
                      <button
                        onClick={() => router.push(`/subjects/${id}/stages/${stage.id}`)}
                        className={cn(
                          'w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-sm font-extrabold z-10 shrink-0 border-2 transition-all',
                          isComplete
                            ? 'bg-green-50 border-green-400 text-green-700'
                            : isActive
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-white border-[#CBD5E1] text-[#94A3B8]'
                        )}
                      >
                        {isComplete ? '✓' : stage.stage_order}
                      </button>
                      {index < stages.length - 1 && (
                        <div className={cn(
                          'w-0.5 flex-1 my-1.5 rounded-full min-h-[16px]',
                          isComplete ? 'bg-green-300' : 'bg-[#E2E8F0]'
                        )} />
                      )}
                    </div>

                    {/* Stage card */}
                    <button
                      onClick={() => router.push(`/subjects/${id}/stages/${stage.id}`)}
                      className={cn(
                        'flex-1 text-left rounded-xl border px-4 py-3.5 mb-3 transition-all group',
                        isActive
                          ? 'border-blue-300 bg-blue-50 hover:border-blue-400'
                          : isComplete
                          ? 'border-[#E2E8F0] bg-white opacity-60 hover:opacity-100 hover:border-green-200'
                          : 'border-[#E2E8F0] bg-white hover:border-blue-200 hover:shadow-sm'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={cn(
                            'font-bold text-sm truncate',
                            isComplete ? 'text-[#64748B]' : 'text-[#0F172A]'
                          )}>
                            {stage.name}
                          </p>
                          <p className="text-[#94A3B8] text-xs mt-0.5">~{stage.estimated_minutes} min</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <MasteryDot level={ml as any} />
                          <StatusChip status={stage.status ?? 'not_started'} />
                        </div>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Layout>
    </>
  )
}

function StatusChip({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    not_started:  { label: 'Not started', cls: 'bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]' },
    in_progress:  { label: 'In progress', cls: 'bg-blue-50 text-blue-600 border border-blue-200' },
    complete:     { label: 'Complete',    cls: 'bg-green-50 text-green-700 border border-green-200' },
    needs_review: { label: 'Review',      cls: 'bg-amber-50 text-amber-600 border border-amber-200' },
  }
  const { label, cls } = cfg[status] ?? cfg.not_started
  return (
    <span className={cn('text-[11px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap', cls)}>
      {label}
    </span>
  )
}
