import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { RequireAuth } from '@/components/RequireAuth'
import { Layout } from '@/components/Layout'
import { Spinner } from '@/components/Spinner'
import { MasteryDot } from '@/components/MasteryDot'
import { ReadinessBar } from '@/components/ReadinessBar'
import { apiJson } from '@/lib/apiFetch'
import { computeReadinessScore, computeNextBestTask } from '@/lib/nextBestTask'
import { daysUntil, formatDate, cn } from '@/lib/utils'
import type { Subject, StudyStage, Topic, MasteryRecord } from '@/types/database'

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
      const details = await Promise.all(subjects.map(s => apiJson<SubjectCard>(`/api/subjects/${s.id}`)))
      setCards(details)
    } catch {
      // silently fail — empty state shows
    } finally {
      setLoading(false)
    }
  }

  const continueCard = cards.find(c => c.stages.some(s => s.status === 'in_progress')) ?? cards[0]
  const continueTask = continueCard
    ? computeNextBestTask(continueCard.stages, continueCard.topics, continueCard.mastery, continueCard.subject.exam_date)
    : null
  const continueStage = continueCard?.stages.find(s => s.status === 'in_progress')

  return (
    <>
      <Head><title>fuckexam</title></Head>
      <Layout
        title="Dashboard"
        actions={
          <Link
            href="/subjects/new"
            className="inline-flex items-center gap-1.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition active:scale-95"
          >
            + Add subject
          </Link>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner className="text-blue-500 w-5 h-5" />
          </div>
        ) : cards.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-8">
            {/* Page header */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B] mb-1.5">Overview</p>
              <h1 className="text-2xl font-extrabold text-[#0F172A]">Your study dashboard</h1>
            </div>

            {/* Continue banner */}
            {continueCard && continueTask && continueTask.type !== 'complete' && continueStage && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center gap-5"
                style={{ background: 'linear-gradient(120deg, #2563EB 0%, #1D4ED8 100%)' }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/65 mb-1.5">
                    Continue where you left off
                  </p>
                  <p className="text-white font-extrabold text-xl leading-tight mb-1">
                    {continueCard.subject.name}
                  </p>
                  <p className="text-white/75 text-sm mb-4">
                    {continueStage.name} · ~{continueStage.estimated_minutes} min
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-white/85 rounded-full"
                        style={{ width: `${computeReadinessScore(continueCard.stages, continueCard.topics, continueCard.mastery)}%` }}
                      />
                    </div>
                    <span className="text-white/75 text-sm font-bold shrink-0">
                      {computeReadinessScore(continueCard.stages, continueCard.topics, continueCard.mastery)}% ready
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (continueTask.stage_id) {
                      router.push(`/subjects/${continueCard.subject.id}/stages/${continueTask.stage_id}`)
                    } else {
                      router.push(`/subjects/${continueCard.subject.id}/path`)
                    }
                  }}
                  className="shrink-0 rounded-xl px-6 py-3 text-sm font-bold text-white border border-white/25 bg-white/15 hover:bg-white/25 transition active:scale-95"
                >
                  Resume →
                </button>
              </motion.div>
            )}

            {/* Subject cards */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-extrabold text-[#0F172A]">Your subjects</h2>
                <span className="text-sm text-[#64748B]">{cards.length} active</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {cards.map(({ subject, topics, stages, mastery, readiness_history }) => {
                  const score = computeReadinessScore(stages, topics, mastery)
                  const days = daysUntil(subject.exam_date)
                  const stagesComplete = stages.filter(s => s.status === 'complete').length

                  return (
                    <Link
                      key={subject.id}
                      href={`/subjects/${subject.id}/path`}
                      className="block bg-white rounded-2xl border border-[#E2E8F0] p-5 hover:border-blue-300 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <p className="text-[#0F172A] font-bold text-sm leading-snug group-hover:text-blue-700 transition">
                          {subject.name}
                        </p>
                        {days !== null && (
                          <span className={cn(
                            'shrink-0 text-[11px] font-bold rounded-full px-2.5 py-0.5 border whitespace-nowrap',
                            days <= 7
                              ? 'bg-red-50 text-red-600 border-red-200'
                              : days <= 14
                              ? 'bg-amber-50 text-amber-600 border-amber-200'
                              : 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]'
                          )}>
                            {days}d
                          </span>
                        )}
                      </div>

                      <p className="text-[#64748B] text-xs mb-3">
                        {subject.exam_date
                          ? new Date(subject.exam_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                          : 'No exam date set'
                        }
                      </p>

                      <ReadinessBar score={score} showLabel={false} />
                      <div className="flex items-center justify-between mt-2 text-xs text-[#64748B]">
                        <span>{stagesComplete}/{stages.length} stages done</span>
                        <span className="font-bold">{score}% ready</span>
                      </div>

                      <div className="border-t border-[#F1F5F9] mt-3 pt-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {topics.slice(0, 8).map(t => {
                            const lvl = mastery.find(m => m.topic_id === t.id)?.level ?? 'grey'
                            return <MasteryDot key={t.id} level={lvl as any} />
                          })}
                          {topics.length > 8 && (
                            <span className="text-[11px] text-[#94A3B8] font-medium">+{topics.length - 8}</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  )
                })}

                {/* Add subject card */}
                <Link
                  href="/subjects/new"
                  className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#CBD5E1] hover:border-blue-400 hover:bg-blue-50 transition-all min-h-[160px] group"
                >
                  <div className="w-10 h-10 rounded-xl border-2 border-dashed border-[#CBD5E1] group-hover:border-blue-400 flex items-center justify-center mb-2 transition">
                    <span className="text-[#94A3B8] group-hover:text-blue-500 text-xl font-light leading-none transition">+</span>
                  </div>
                  <p className="text-[#64748B] group-hover:text-blue-600 text-sm font-medium transition">Add a subject</p>
                  <p className="text-[#94A3B8] text-xs mt-1 text-center max-w-[140px]">Upload your notes and get a study path</p>
                </Link>
              </div>
            </div>

            {/* Summary table */}
            {cards.length > 0 && (
              <div>
                <h2 className="text-base font-extrabold text-[#0F172A] mb-4">Summary</h2>
                <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                          {['Subject', 'Exam date', 'Days left', 'Readiness', 'Stages', 'Mastery'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.09em] text-[#64748B] whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cards.map(({ subject, topics, stages, mastery }, i) => {
                          const score = computeReadinessScore(stages, topics, mastery)
                          const days = daysUntil(subject.exam_date)
                          const stagesComplete = stages.filter(s => s.status === 'complete').length
                          const solidCount = topics.filter(t => (mastery.find(m => m.topic_id === t.id)?.level ?? 'grey') === 'green').length

                          return (
                            <tr
                              key={subject.id}
                              className="border-b border-[#F1F5F9] last:border-0 hover:bg-blue-50 cursor-pointer transition"
                              onClick={() => router.push(`/subjects/${subject.id}/path`)}
                            >
                              <td className="px-4 py-3 font-bold text-sm text-[#0F172A]">{subject.name}</td>
                              <td className="px-4 py-3 text-sm text-[#64748B]">
                                {subject.exam_date
                                  ? new Date(subject.exam_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                                  : '—'}
                              </td>
                              <td className="px-4 py-3">
                                {days !== null ? (
                                  <span className={cn(
                                    'text-[11px] font-bold rounded-full px-2.5 py-0.5 border',
                                    days <= 7
                                      ? 'bg-red-50 text-red-600 border-red-200'
                                      : days <= 14
                                      ? 'bg-amber-50 text-amber-600 border-amber-200'
                                      : 'bg-blue-50 text-blue-600 border-blue-200'
                                  )}>
                                    {days} days
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
                                    <div
                                      className={cn('h-full rounded-full', score >= 70 ? 'bg-green-600' : score >= 40 ? 'bg-amber-500' : 'bg-red-500')}
                                      style={{ width: `${score}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-bold text-[#0F172A]">{score}%</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-[#64748B] font-medium">{stagesComplete}/{stages.length}</td>
                              <td className="px-4 py-3 text-sm text-[#64748B] font-medium">{solidCount}/{topics.length} mastered</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Layout>
    </>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-3xl font-extrabold mb-6">f</div>
      <h2 className="text-[#0F172A] font-extrabold text-2xl mb-2">Ready to start?</h2>
      <p className="text-[#64748B] text-sm mb-8 max-w-xs leading-relaxed">
        Upload your notes, get a personalised study plan, and track your exam readiness.
      </p>
      <Link
        href="/subjects/new"
        className="rounded-xl px-7 py-3 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition active:scale-95"
      >
        Add your first subject →
      </Link>
    </div>
  )
}
