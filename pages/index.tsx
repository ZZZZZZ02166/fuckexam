import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { RequireAuth } from '@/components/RequireAuth'
import { ReadinessBar } from '@/components/ReadinessBar'
import { Spinner } from '@/components/Spinner'
import { apiJson } from '@/lib/apiFetch'
import { supabase } from '@/lib/supabase/client'
import { computeReadinessScore } from '@/lib/nextBestTask'
import { computeNextBestTask } from '@/lib/nextBestTask'
import { daysUntil, formatDate, cn } from '@/lib/utils'
import type { Subject, StudyStage, Topic, MasteryRecord, NextBestTask } from '@/types/database'

interface SubjectCard {
  subject: Subject
  topics: Topic[]
  stages: StudyStage[]
  mastery: MasteryRecord[]
  readiness_history: { score: number; computed_at: string }[]
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  )
}

function Dashboard() {
  const router = useRouter()
  const [cards, setCards] = useState<SubjectCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSubjects()
  }, [])

  async function loadSubjects() {
    try {
      const subjects = await apiJson<Subject[]>('/api/subjects')
      if (!subjects.length) { setLoading(false); return }

      const details = await Promise.all(
        subjects.map(s => apiJson<SubjectCard>(`/api/subjects/${s.id}`))
      )
      setCards(details)
    } catch {
      // silently fail — empty state shows
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const continueCard = cards.find(c =>
    c.stages.some(s => s.status === 'in_progress')
  ) ?? cards[0]

  const continueTask = continueCard
    ? computeNextBestTask(continueCard.stages, continueCard.topics, continueCard.mastery, continueCard.subject.exam_date)
    : null

  return (
    <>
      <Head><title>fuckexam</title></Head>
      <div className="min-h-screen bg-slate-50">
        {/* Nav */}
        <div className="bg-white border-b border-slate-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <h1 className="text-base font-bold text-slate-900 tracking-tight">fuckexam</h1>
            <button
              onClick={handleSignOut}
              className="text-slate-400 hover:text-slate-700 text-sm transition"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner className="text-blue-500 w-5 h-5" />
            </div>
          ) : cards.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {/* Continue now banner */}
              {continueCard && continueTask && continueTask.type !== 'complete' && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">
                    Continue
                  </p>
                  <p className="text-slate-900 font-medium text-sm mb-0.5">
                    {continueCard.subject.name}
                  </p>
                  <p className="text-slate-500 text-sm mb-3">{continueTask.reason}</p>
                  <button
                    onClick={() => {
                      if (continueTask.stage_id) {
                        router.push(`/subjects/${continueCard.subject.id}/stages/${continueTask.stage_id}`)
                      } else {
                        router.push(`/subjects/${continueCard.subject.id}/path`)
                      }
                    }}
                    className="rounded-lg px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
                  >
                    Continue →
                  </button>
                </div>
              )}

              {/* Subjects grid */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Your subjects</h2>
                  <Link href="/subjects/new" className="text-sm text-blue-600 hover:text-blue-700 font-medium transition">+ New subject</Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {cards.map(({ subject, topics, stages, mastery, readiness_history }) => {
                    const score = readiness_history[0]?.score ?? computeReadinessScore(topics, mastery)
                    const days = daysUntil(subject.exam_date)
                    const stagesComplete = stages.filter(s => s.status === 'complete').length

                    return (
                      <Link key={subject.id} href={`/subjects/${subject.id}/path`} className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-md shadow-sm transition">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <p className="text-slate-900 font-semibold text-sm leading-snug">{subject.name}</p>
                          {days !== null && (
                            <span className={cn(
                              'shrink-0 text-xs font-medium rounded-full px-2 py-0.5',
                              days <= 7 ? 'bg-red-50 text-red-600' :
                              days <= 14 ? 'bg-yellow-50 text-yellow-700' :
                              'bg-slate-100 text-slate-500'
                            )}>
                              {days}d
                            </span>
                          )}
                        </div>

                        <ReadinessBar score={score} size="sm" />

                        <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
                          <span>{stagesComplete}/{stages.length} stages done</span>
                          {subject.exam_date && (
                            <span>Exam {formatDate(subject.exam_date)}</span>
                          )}
                        </div>
                      </Link>
                    )
                  })}

                  {/* Add card */}
                  <Link href="/subjects/new" className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-transparent p-4 hover:border-slate-400 hover:bg-slate-50 transition min-h-[120px]">
                    <div className="text-center">
                      <p className="text-slate-400 text-2xl mb-1">+</p>
                      <p className="text-slate-400 text-sm">Add subject</p>
                    </div>
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-4xl mb-4">📚</p>
      <h2 className="text-slate-900 font-semibold text-lg mb-2">No subjects yet</h2>
      <p className="text-slate-500 text-sm mb-6 max-w-xs">
        Upload your course materials and get a personalised study path for your next exam.
      </p>
      <Link href="/subjects/new" className="rounded-lg px-5 py-2.5 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition">
        Add your first subject →
      </Link>
    </div>
  )
}
