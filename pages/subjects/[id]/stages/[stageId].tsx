import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { RequireAuth } from '@/components/RequireAuth'
import { Layout } from '@/components/Layout'
import { MasteryDot, MasteryChip } from '@/components/MasteryDot'
import { Spinner } from '@/components/Spinner'
import { apiJson } from '@/lib/apiFetch'
import { cn } from '@/lib/utils'
import type {
  StudyStage, Topic, GeneratedItem, Question,
  SummaryContent, FlashcardsContent, ConceptMapContent,
  MCQContent, RecallContent, MasteryLevel, MaterialType, MasteryRecord,
} from '@/types/database'

type Tab = 'summary' | 'flashcards' | 'concept_map'
type Mode = 'study' | 'quiz' | 'results'

interface StagePageData {
  stage: StudyStage & { subjects: { name: string; exam_format_text: string | null; user_id: string } }
  topics: Topic[]
  generated: GeneratedItem[]
  questions: Question[]
}

interface QuizAnswer {
  question_id: string
  topic_id: string | null
  score: 'correct' | 'partial' | 'wrong'
  feedback: { correct_parts?: string[]; missing_parts?: string[]; source_quote?: string } | null
  answer_text: string
}

const TAB_LABELS: Record<Tab, string> = {
  summary: 'Summary',
  flashcards: 'Flashcards',
  concept_map: 'Concept Map',
}

export default function StagePage() {
  return <RequireAuth><StageView /></RequireAuth>
}

function StageView() {
  const router = useRouter()
  const { id: subjectId, stageId } = router.query as { id: string; stageId: string }

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<StagePageData | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const [generating, setGenerating] = useState(false)
  const [mode, setMode] = useState<Mode>('study')
  const [masteryMap, setMasteryMap] = useState<Map<string, string>>(new Map())
  const [totalStages, setTotalStages] = useState(0)

  const [questions, setQuestions] = useState<Question[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [scoring, setScoring] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [lastFeedback, setLastFeedback] = useState<QuizAnswer | null>(null)
  const [mcqSelected, setMcqSelected] = useState<number | null>(null)
  const [submittingResults, setSubmittingResults] = useState(false)

  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    if (!stageId) return
    loadStage()
  }, [stageId])

  async function loadStage() {
    setLoading(true)
    let genItems: GeneratedItem[] = []
    try {
      const subjectData = await apiJson<any>(`/api/subjects/${subjectId}`)
      const stage = subjectData.stages.find((s: StudyStage) => s.id === stageId)
      if (!stage) { router.replace(`/subjects/${subjectId}/path`); return }

      setTotalStages(subjectData.stages.length)

      const stageTopics = subjectData.topics.filter((t: Topic) =>
        (stage.topic_ids ?? []).includes(t.id)
      )

      const masteryRecords: MasteryRecord[] = subjectData.mastery ?? []
      setMasteryMap(new Map(masteryRecords.map(m => [m.topic_id, m.level ?? 'grey'])))

      const [genRes, qRes] = await Promise.allSettled([
        apiJson<GeneratedItem[]>(`/api/stages/${stageId}/content-list`).catch(() => []),
        apiJson<Question[]>(`/api/stages/${stageId}/quiz`).catch(() => []),
      ])

      genItems = genRes.status === 'fulfilled' ? genRes.value : []

      setData({
        stage: { ...stage, subjects: { name: subjectData.subject.name, exam_format_text: subjectData.subject.exam_format_text, user_id: subjectData.subject.user_id } },
        topics: stageTopics,
        generated: genItems,
        questions: qRes.status === 'fulfilled' ? qRes.value : [],
      })
    } finally {
      setLoading(false)
    }

    if (!genItems.find(g => g.type === 'summary')) {
      setGenerating(true)
      try {
        const item = await apiJson<GeneratedItem>(`/api/stages/${stageId}/content`, {
          method: 'POST',
          body: JSON.stringify({ type: 'summary' }),
        })
        setData(prev => prev ? { ...prev, generated: [...prev.generated, item] } : prev)
      } catch { /* silently fail */ }
      setGenerating(false)
    }
  }

  async function generateContent(type: Tab, force = false) {
    if (!data) return
    const existing = data.generated.find(g => g.type === type)
    if (existing && !force) return
    setGenerating(true)
    if (force) setData(prev => prev ? { ...prev, generated: prev.generated.filter(g => g.type !== type) } : prev)
    try {
      const item = await apiJson<GeneratedItem>(`/api/stages/${stageId}/content`, {
        method: 'POST',
        body: JSON.stringify({ type, force }),
      })
      setData(prev => prev ? { ...prev, generated: [...prev.generated.filter(g => g.type !== type), item] } : prev)
    } finally {
      setGenerating(false)
    }
  }

  async function startQuiz() {
    if (!data) return
    setMode('quiz')
    setQIndex(0)
    setAnswers([])
    setCurrentAnswer('')
    setShowFeedback(false)
    setMcqSelected(null)

    let qs = data.questions
    if (!qs.length) {
      setGenerating(true)
      try {
        qs = await apiJson<Question[]>(`/api/stages/${stageId}/quiz`, { method: 'POST' })
        setData(prev => prev ? { ...prev, questions: qs } : prev)
      } finally {
        setGenerating(false)
      }
    }
    setQuestions(qs)
  }

  async function submitRecall() {
    if (!questions[qIndex]) return
    const q = questions[qIndex]
    setScoring(true)
    try {
      const { feedback } = await apiJson<{ feedback: QuizAnswer['feedback'] & { score: 'correct' | 'partial' | 'wrong' } }>(`/api/stages/${stageId}/recall`, {
        method: 'POST',
        body: JSON.stringify({ question_id: q.id, answer_text: currentAnswer }),
      })
      const ans: QuizAnswer = {
        question_id: q.id,
        topic_id: q.topic_id,
        score: (feedback as any).score,
        feedback: { correct_parts: (feedback as any).correct_parts, missing_parts: (feedback as any).missing_parts, source_quote: (feedback as any).source_quote },
        answer_text: currentAnswer,
      }
      setLastFeedback(ans)
      setShowFeedback(true)
      setAnswers(prev => [...prev, ans])
    } finally {
      setScoring(false)
    }
  }

  function submitMCQ(selectedIndex: number) {
    if (!questions[qIndex]) return
    const q = questions[qIndex]
    const content = q.content as unknown as MCQContent
    const score: 'correct' | 'wrong' = selectedIndex === content.correct_index ? 'correct' : 'wrong'
    const ans: QuizAnswer = {
      question_id: q.id,
      topic_id: q.topic_id,
      score,
      feedback: null,
      answer_text: content.options[selectedIndex],
    }
    setMcqSelected(selectedIndex)
    setLastFeedback(ans)
    setShowFeedback(true)
    setAnswers(prev => [...prev, ans])
  }

  async function nextQuestion() {
    setShowFeedback(false)
    setCurrentAnswer('')
    setMcqSelected(null)
    if (qIndex + 1 >= questions.length) {
      await finishQuiz()
    } else {
      setQIndex(prev => prev + 1)
    }
  }

  async function finishQuiz() {
    setSubmittingResults(true)
    try {
      await apiJson(`/api/mastery/${subjectId}`, {
        method: 'POST',
        body: JSON.stringify({
          stage_id: stageId,
          answers: answers.map(a => ({ question_id: a.question_id, topic_id: a.topic_id, score: a.score })),
        }),
      })
    } finally {
      setSubmittingResults(false)
      setMode('results')
    }
  }

  const correctCount = answers.filter(a => a.score === 'correct').length
  const partialCount = answers.filter(a => a.score === 'partial').length

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F0F4FF]">
      <Spinner className="text-blue-500 w-5 h-5" />
    </div>
  )
  if (!data) return null

  const { stage, topics, generated } = data

  const statusLabel = (s: string) => ({
    not_started: 'Not started',
    in_progress: 'In progress',
    complete: 'Complete',
    needs_review: 'Needs review',
  }[s] ?? s)

  return (
    <>
      <Head><title>{stage.name} — fuckexam</title></Head>
      <Layout
        backHref={`/subjects/${subjectId}/path`}
        backLabel="Study Path"
        title="Stage View"
      >
        {/* STUDY MODE */}
        {mode === 'study' && (
          <div className="grid lg:grid-cols-[1fr_280px] gap-6 items-start">
            {/* Left column */}
            <div className="space-y-5">
              {/* Stage heading */}
              <div className="border-b border-[#F1F5F9] pb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-flex items-center text-[11px] font-extrabold uppercase tracking-[0.1em] text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                    Stage {stage.stage_order}
                  </span>
                  <span className="text-[#CBD5E1]">·</span>
                  <span className="text-xs font-semibold text-[#64748B] truncate">{stage.subjects.name}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <h1 className="text-2xl font-extrabold text-[#0F172A] leading-tight tracking-tight">{stage.name}</h1>
                  <div className="flex items-center gap-2 shrink-0 mt-1">
                    <span className="text-xs font-bold text-[#475569] bg-[#F1F5F9] border border-[#E2E8F0] px-3 py-1.5 rounded-full">
                      ~{stage.estimated_minutes} min
                    </span>
                    <button
                      onClick={startQuiz}
                      disabled={generating}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-2 rounded-xl transition active:scale-95 shadow-sm"
                    >
                      Test myself →
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 bg-[#EEF2FF] rounded-xl p-1 border border-[#E2E8F0]">
                {(['summary', 'flashcards', 'concept_map'] as Tab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={async () => {
                      setActiveTab(tab)
                      if (!generated.find(g => g.type === tab)) {
                        await generateContent(tab)
                      }
                    }}
                    className={cn(
                      'flex-1 rounded-lg px-2 sm:px-3 py-2 text-xs sm:text-sm font-bold transition',
                      activeTab === tab
                        ? 'bg-white text-blue-600 shadow-sm border border-blue-100'
                        : 'text-[#64748B] hover:text-[#334155] hover:bg-white/50'
                    )}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="min-h-[320px]">
                {generating && !generated.find(g => g.type === activeTab) ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                      <Spinner className="text-blue-500 w-5 h-5" />
                    </div>
                    <p className="text-[#64748B] text-sm font-medium">Generating {TAB_LABELS[activeTab].toLowerCase()}…</p>
                  </div>
                ) : (
                  <TabContent
                    tab={activeTab}
                    item={generated.find(g => g.type === activeTab) ?? null}
                    cardIndex={cardIndex}
                    flipped={flipped}
                    onCardFlip={() => setFlipped(f => !f)}
                    onCardGotIt={() => { setFlipped(false); setCardIndex(i => i + 1) }}
                    onCardAgain={() => setFlipped(false)}
                    onGenerateContent={generateContent}
                  />
                )}
              </div>
            </div>

            {/* Right panel */}
            <div className="space-y-4 lg:sticky lg:top-[78px]">
              {/* Stage info */}
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5">
                <h3 className="font-extrabold text-[#0F172A] text-sm mb-4">Stage info</h3>
                <div className="space-y-0">
                  {[
                    ['Estimated time', `~${stage.estimated_minutes} min`],
                    ['Status', statusLabel(stage.status ?? 'not_started')],
                    ['Order', `Stage ${stage.stage_order} of ${totalStages || '?'}`],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between py-2.5 border-b border-[#F1F5F9] last:border-0">
                      <span className="text-[13px] text-[#64748B] font-medium">{label}</span>
                      <span className="text-[13px] font-bold text-[#0F172A]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Topics in this stage */}
              {topics.length > 0 && (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5">
                  <h3 className="font-extrabold text-[#0F172A] text-sm mb-4">Topics in this stage</h3>
                  <div className="space-y-2">
                    {topics.map(t => {
                      const level = (masteryMap.get(t.id) ?? 'grey') as MasteryLevel
                      return (
                        <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-[#F1F5F9] bg-[#F8FAFC]">
                          <MasteryDot level={level} />
                          <span className="flex-1 text-[13px] font-medium text-[#0F172A] truncate">{t.name}</span>
                          <MasteryChip level={level} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Test myself button */}
              <button
                onClick={startQuiz}
                disabled={generating}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition active:scale-95 text-sm"
              >
                Test myself →
              </button>
            </div>
          </div>
        )}

        {/* QUIZ MODE */}
        {mode === 'quiz' && (
          <div className="max-w-2xl mx-auto space-y-5">
            {generating ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <Spinner className="text-blue-500 w-5 h-5" />
                </div>
                <p className="text-[#64748B] text-sm font-medium">Generating questions…</p>
              </div>
            ) : questions.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[#64748B] font-bold">
                    Question {qIndex + 1} <span className="text-[#CBD5E1]">/ {questions.length}</span>
                  </p>
                  <button onClick={() => setMode('study')} className="text-xs text-[#64748B] hover:text-[#0F172A] transition font-medium">
                    Exit
                  </button>
                </div>

                {/* Progress bar */}
                <div className="flex gap-1.5">
                  {questions.map((_, qi) => {
                    const ans = answers[qi]
                    return (
                      <div
                        key={qi}
                        className={cn(
                          'flex-1 h-1.5 rounded-full transition-all',
                          qi < qIndex
                            ? ans?.score === 'correct' ? 'bg-green-500'
                            : ans?.score === 'partial' ? 'bg-amber-400'
                            : 'bg-red-400'
                            : qi === qIndex ? 'bg-blue-500'
                            : 'bg-[#E2E8F0]'
                        )}
                      />
                    )
                  })}
                </div>

                <QuestionCard
                  question={questions[qIndex]}
                  showFeedback={showFeedback}
                  lastFeedback={lastFeedback}
                  mcqSelected={mcqSelected}
                  currentAnswer={currentAnswer}
                  scoring={scoring}
                  onAnswerChange={setCurrentAnswer}
                  onSubmitRecall={submitRecall}
                  onSubmitMCQ={submitMCQ}
                  onNext={nextQuestion}
                />
              </>
            ) : null}
          </div>
        )}

        {/* RESULTS MODE */}
        {mode === 'results' && (
          <div className="max-w-xl mx-auto space-y-5">
            <ResultsCard
              correctCount={correctCount}
              partialCount={partialCount}
              total={answers.length}
            />

            {answers.filter(a => a.score !== 'correct').length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-[0.12em] mb-3">Missed questions</p>
                <div className="space-y-2">
                  {answers.filter(a => a.score !== 'correct').map(a => {
                    const q = questions.find(q => q.id === a.question_id)
                    if (!q) return null
                    return (
                      <div key={a.question_id} className="bg-white rounded-xl border border-[#E2E8F0] px-4 py-3 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={a.score === 'partial' ? 'text-amber-500' : 'text-red-500'}>
                            {a.score === 'partial' ? '◑' : '✗'}
                          </span>
                          <p className="text-[#0F172A] font-medium text-sm">
                            {q.type === 'recall'
                              ? (q.content as unknown as RecallContent).prompt
                              : (q.content as unknown as MCQContent).question}
                          </p>
                        </div>
                        {a.feedback?.missing_parts?.length ? (
                          <p className="text-[#64748B] text-xs pl-5">Missed: {a.feedback.missing_parts.join(', ')}</p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {submittingResults ? (
              <div className="flex items-center justify-center gap-2 py-2">
                <Spinner className="text-blue-500 w-4 h-4" />
                <span className="text-[#64748B] text-sm">Saving…</span>
              </div>
            ) : (
              <button
                onClick={() => router.push(`/subjects/${subjectId}/path`)}
                className="w-full rounded-xl px-4 py-3.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition active:scale-95"
              >
                Back to study path →
              </button>
            )}
          </div>
        )}
      </Layout>
    </>
  )
}

function ResultsCard({ correctCount, partialCount, total }: { correctCount: number; partialCount: number; total: number }) {
  const score = total > 0 ? Math.round(((correctCount + partialCount * 0.5) / total) * 100) : 0
  const stars = score >= 80 ? 3 : score >= 50 ? 2 : score >= 20 ? 1 : 0
  const isGreat = score >= 70

  return (
    <div className={cn(
      'rounded-2xl border p-8 text-center',
      isGreat ? 'border-green-200 bg-green-50' : 'border-[#E2E8F0] bg-white'
    )}>
      <div className="flex justify-center gap-1 mb-4">
        {[1, 2, 3].map(s => (
          <span key={s} className={cn('text-3xl transition-all', s <= stars ? 'opacity-100' : 'opacity-15 grayscale')}>⭐</span>
        ))}
      </div>
      <div className={cn(
        'w-24 h-24 rounded-full border-4 flex flex-col items-center justify-center mx-auto mb-5',
        isGreat ? 'border-green-500 bg-green-100' : 'border-blue-400 bg-blue-50'
      )}>
        <p className={cn('font-extrabold text-3xl tabular-nums leading-none', isGreat ? 'text-green-700' : 'text-blue-700')}>
          {score}%
        </p>
      </div>
      <p className="text-[#64748B] text-sm">
        {correctCount} correct · {partialCount} partial · {total - correctCount - partialCount} missed
      </p>
    </div>
  )
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-800 font-semibold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-blue-700 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
}

const NODE_TYPE_CLASSES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  concept:      { bg: 'bg-violet-50',   border: 'border-violet-300',  text: 'text-violet-900',   badge: 'bg-violet-200 text-violet-800' },
  definition:   { bg: 'bg-purple-50',   border: 'border-purple-300',  text: 'text-purple-900',   badge: 'bg-purple-200 text-purple-800' },
  process:      { bg: 'bg-sky-50',      border: 'border-sky-300',     text: 'text-sky-900',      badge: 'bg-sky-200 text-sky-800' },
  solution:     { bg: 'bg-emerald-50',  border: 'border-emerald-300', text: 'text-emerald-900',  badge: 'bg-emerald-200 text-emerald-800' },
  problem:      { bg: 'bg-red-50',      border: 'border-red-300',     text: 'text-red-900',      badge: 'bg-red-200 text-red-800' },
  exam_trap:    { bg: 'bg-amber-50',    border: 'border-amber-300',   text: 'text-amber-900',    badge: 'bg-amber-200 text-amber-800' },
  limitation:   { bg: 'bg-orange-50',   border: 'border-orange-300',  text: 'text-orange-900',   badge: 'bg-orange-200 text-orange-800' },
  comparison:   { bg: 'bg-cyan-50',     border: 'border-cyan-300',    text: 'text-cyan-900',     badge: 'bg-cyan-200 text-cyan-800' },
  evidence:     { bg: 'bg-teal-50',     border: 'border-teal-300',    text: 'text-teal-900',     badge: 'bg-teal-200 text-teal-800' },
  formula:      { bg: 'bg-pink-50',     border: 'border-pink-300',    text: 'text-pink-900',     badge: 'bg-pink-200 text-pink-800' },
  example:      { bg: 'bg-slate-50',    border: 'border-slate-300',   text: 'text-slate-800',    badge: 'bg-slate-200 text-slate-700' },
  code_example: { bg: 'bg-zinc-50',     border: 'border-emerald-300', text: 'text-emerald-800',  badge: 'bg-emerald-100 text-emerald-700' },
}

function nodeTypeClasses(type: string) {
  return NODE_TYPE_CLASSES[type] ?? NODE_TYPE_CLASSES.concept
}

function SectionLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-base leading-none">{icon}</span>
      <p className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-[#334155]">{text}</p>
    </div>
  )
}

function SummaryTab({ content }: { content: SummaryContent }) {
  const [revealedChecks, setRevealedChecks] = useState<Set<number>>(new Set())
  const [showNotes, setShowNotes] = useState(false)

  const toggleCheck = (i: number) => setRevealedChecks(prev => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  return (
    <div className="space-y-6">
      {content.quickOverview?.length > 0 && (
        <div>
          <SectionLabel icon="⚡" text="Learn this in 5 min" />
          <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-100">
            <ul className="space-y-2">
              {content.quickOverview.map((item, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-[#1E293B]">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {content.bigIdea && (
        <div>
          <SectionLabel icon="💡" text="Big Idea" />
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <p className="text-blue-800 text-sm leading-relaxed">{content.bigIdea}</p>
          </div>
        </div>
      )}

      {content.keyConcepts?.length > 0 && (
        <div>
          <SectionLabel icon="🎯" text="Key Concepts" />
          <div className="space-y-2">
            {content.keyConcepts.map((kc, i) => (
              <div key={i} className="flex bg-white rounded-xl border border-[#E2E8F0] overflow-hidden shadow-sm">
                <div className="w-[3px] shrink-0 bg-blue-500" />
                <div className="px-4 py-3 flex-1 min-w-0">
                  <p className="text-[#0F172A] font-bold text-sm">{kc.term}</p>
                  <p className="text-[#64748B] text-sm mt-1 leading-relaxed">{kc.explanation}</p>
                  <p className="text-blue-600 text-xs mt-1.5 font-medium">{kc.whyItMatters}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.ideaConnections?.length > 0 && (
        <div>
          <SectionLabel icon="🔗" text="How It Connects" />
          <div className="space-y-2">
            {content.ideaConnections.map((conn, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5">
                <span className="rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-blue-700 font-semibold text-xs">{conn.from}</span>
                <span className="text-[#94A3B8] text-xs font-medium">→</span>
                <span className="text-[#64748B] text-xs italic flex-1">{conn.relationship}</span>
                <span className="text-[#94A3B8] text-xs font-medium">→</span>
                <span className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-[#334155] font-semibold text-xs">{conn.to}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.examTraps?.length > 0 && (
        <div>
          <SectionLabel icon="⚠️" text="Exam Traps" />
          <div className="space-y-2">
            {content.examTraps.map((trap, i) => (
              <div key={i} className="bg-amber-50 rounded-xl border border-amber-200 border-l-2 border-l-red-500 px-4 py-3">
                <p className="text-red-600 text-sm">✗ {trap.trap}</p>
                <p className="text-green-700 text-sm mt-1.5 font-medium">✓ {trap.correction}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.quickCheck?.length > 0 && (
        <div>
          <SectionLabel icon="✅" text="Quick Check" />
          <div className="space-y-2">
            {content.quickCheck.map((qc, i) => (
              <div key={i} className="bg-white rounded-xl border border-[#E2E8F0] px-4 py-3">
                <p className="text-[#0F172A] text-sm font-medium">{qc.question}</p>
                {revealedChecks.has(i) ? (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[#64748B] text-sm mt-2 leading-relaxed"
                  >
                    {qc.answer}
                  </motion.p>
                ) : (
                  <button
                    onClick={() => toggleCheck(i)}
                    className="text-blue-600 text-xs mt-2 hover:text-blue-700 transition font-medium"
                  >
                    Show Answer ▾
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {content.detailedNotes && (
        <div>
          <button
            onClick={() => setShowNotes(v => !v)}
            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#94A3B8] hover:text-[#64748B] transition"
          >
            📄 Detailed Notes <span>{showNotes ? '▲' : '▾'}</span>
          </button>
          {showNotes && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 space-y-3"
            >
              <MarkdownBlocks text={content.detailedNotes} />
            </motion.div>
          )}
        </div>
      )}
    </div>
  )
}

function ConceptFlowMap({ content, onRetry }: { content: ConceptMapContent; onRetry: () => void }) {
  const { nodes, relationships, title } = content

  if (!nodes?.length || !relationships?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <p className="text-[#94A3B8] text-sm">Concept map could not be loaded.</p>
        <button onClick={onRetry} className="text-blue-600 text-sm hover:text-blue-700 transition">
          Retry ↺
        </button>
      </div>
    )
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const adj = new Map<string, string[]>()
  const inDeg = new Map<string, number>()
  const relMap = new Map<string, string>()

  nodes.forEach(n => { adj.set(n.id, []); inDeg.set(n.id, 0) })
  relationships.forEach(r => {
    if (!nodeMap.has(r.from) || !nodeMap.has(r.to)) return
    adj.get(r.from)!.push(r.to)
    inDeg.set(r.to, (inDeg.get(r.to) ?? 0) + 1)
    relMap.set(`${r.from}:${r.to}`, r.label)
  })

  const rootIds = nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0).map(n => n.id)
  let fallbackRoot: string | undefined
  if (!rootIds.length && nodes.length) {
    const importanceOrder = ['primary', 'secondary', 'supporting']
    const sorted = [...nodes].sort((a, b) => {
      const ai = importanceOrder.indexOf((a as any).importance ?? 'supporting')
      const bi = importanceOrder.indexOf((b as any).importance ?? 'supporting')
      if (ai !== bi) return ai - bi
      if (a.type === 'concept' && b.type !== 'concept') return -1
      if (b.type === 'concept' && a.type !== 'concept') return 1
      return 0
    })
    fallbackRoot = sorted[0]?.id
  }
  const visited = new Set<string>()
  const levels: string[][] = []
  let frontier = rootIds.length ? rootIds : (fallbackRoot ? [fallbackRoot] : [])

  while (frontier.length) {
    const current = frontier.filter(id => !visited.has(id))
    if (!current.length) break
    current.forEach(id => visited.add(id))
    levels.push(current)
    const next: string[] = []
    current.forEach(id => {
      ;(adj.get(id) ?? []).forEach(child => {
        if (!visited.has(child) && !next.includes(child)) next.push(child)
      })
    })
    frontier = next
  }

  const orphans = nodes.filter(n => !visited.has(n.id))

  function getLevelConnector(fromIds: string[], toIds: string[]): string | null {
    for (const from of fromIds) {
      for (const to of toIds) {
        const label = relMap.get(`${from}:${to}`)
        if (label) return label
      }
    }
    return null
  }

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <p className="text-blue-800 font-bold text-sm">{title}</p>
      </div>

      {levels.map((level, li) => {
        const connector = li < levels.length - 1 ? getLevelConnector(level, levels[li + 1]) : null
        return (
          <div key={li}>
            <div className={cn(
              'grid gap-2',
              level.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            )}>
              {level.map(id => {
                const node = nodeMap.get(id)
                if (!node) return null
                const cls = nodeTypeClasses(node.type)
                return (
                  <div key={id} className={cn('rounded-xl border-[1.5px] px-4 py-3.5', cls.bg, cls.border)}>
                    <span className={cn('inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', cls.badge)}>
                      {node.type.replace(/_/g, ' ')}
                    </span>
                    <p className={cn('font-bold mt-2', cls.text,
                      (node as any).importance === 'primary' ? 'text-sm' :
                      (node as any).importance === 'supporting' ? 'text-xs opacity-80' : 'text-sm'
                    )}>{node.label}</p>
                    <p className="text-slate-600 text-xs mt-1.5 leading-relaxed">{node.detail}</p>
                  </div>
                )
              })}
            </div>

            {connector && (
              <div className="flex flex-col items-center py-1.5 gap-0.5">
                <div className="w-px h-3 bg-slate-300" />
                <span className="rounded-full bg-white border border-slate-300 px-2.5 py-0.5 text-slate-500 text-[11px]">
                  {connector}
                </span>
                <div className="w-px h-3 bg-slate-300" />
              </div>
            )}
          </div>
        )
      })}

      {orphans.length > 0 && (
        <div className="pt-2">
          <SectionLabel icon="↗" text="Also see" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {orphans.map(node => {
              const cls = nodeTypeClasses(node.type)
              return (
                <div key={node.id} className={cn('rounded-xl border-[1.5px] px-4 py-3.5', cls.bg, cls.border)}>
                  <span className={cn('inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', cls.badge)}>
                    {node.type.replace(/_/g, ' ')}
                  </span>
                  <p className={cn('font-bold mt-2 text-sm', cls.text)}>{node.label}</p>
                  <p className="text-slate-600 text-xs mt-1.5 leading-relaxed">{node.detail}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function MarkdownBlocks({ text }: { text: string }) {
  const segments = text.split(/(```[\s\S]*?```)/g)
  const elements: React.ReactNode[] = []

  segments.forEach((segment, si) => {
    if (segment.startsWith('```')) {
      const code = segment.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
      elements.push(
        <pre key={`code-${si}`} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-blue-700 font-mono overflow-x-auto whitespace-pre-wrap">
          {code.trim()}
        </pre>
      )
      return
    }

    segment.split(/\n\n+/).forEach((block, bi) => {
      const trimmed = block.trim()
      if (!trimmed) return
      const key = `${si}-${bi}`

      if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
        const isH3 = trimmed.startsWith('### ')
        const lines = trimmed.split('\n')
        const heading = lines[0].slice(isH3 ? 4 : 3).trim()
        const rest = lines.slice(1).join('\n').trim()
        elements.push(
          <div key={key}>
            <div className="flex items-center gap-2 mt-3 mb-1">
              <span className={`w-1 rounded-full shrink-0 ${isH3 ? 'h-4 bg-blue-500' : 'h-5 bg-sky-400'}`} />
              <h3 className="text-[#0F172A] font-bold text-sm">{heading}</h3>
            </div>
            {rest && (
              <p className="text-[#64748B] text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderInline(rest.replace(/\n/g, ' ')) }} />
            )}
          </div>
        )
        return
      }

      const lines = trimmed.split('\n')
      if (lines.length >= 1 && lines.every(l => /^[-*]\s/.test(l.trim()))) {
        elements.push(
          <ul key={key} className="space-y-1.5">
            {lines.map((line, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-[#64748B]">
                <span className="mt-[6px] w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                <span dangerouslySetInnerHTML={{ __html: renderInline(line.replace(/^[-*]\s+/, '')) }} />
              </li>
            ))}
          </ul>
        )
        return
      }

      elements.push(
        <p key={key} className="text-[#64748B] text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderInline(trimmed.replace(/\n/g, ' ')) }} />
      )
    })
  })

  return <>{elements}</>
}

function TabContent({
  tab, item, cardIndex, flipped, onCardFlip, onCardGotIt, onCardAgain, onGenerateContent
}: {
  tab: Tab
  item: GeneratedItem | null
  cardIndex: number
  flipped: boolean
  onCardFlip: () => void
  onCardGotIt: () => void
  onCardAgain: () => void
  onGenerateContent: (type: MaterialType, force?: boolean) => void
}) {
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2">
        <p className="text-[#94A3B8] text-sm">Switch tabs to generate content</p>
      </div>
    )
  }

  if (tab === 'summary') {
    const content = item.content as unknown as SummaryContent
    return <SummaryTab content={content} />
  }

  if (tab === 'flashcards') {
    const content = item.content as unknown as FlashcardsContent
    const cards = content.cards ?? []
    const idx = cardIndex % cards.length
    const card = cards[idx]

    if (!card) return <p className="text-[#94A3B8] text-sm text-center">No flashcards generated.</p>

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-[#64748B] font-bold">Card {idx + 1} of {cards.length}</p>
          <div className="flex gap-1">
            {cards.map((_, ci) => (
              <span key={ci} className={cn('w-1.5 h-1.5 rounded-full transition-colors', ci === idx ? 'bg-blue-500' : 'bg-[#E2E8F0]')} />
            ))}
          </div>
        </div>
        <motion.div
          key={`${idx}-${flipped}`}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15 }}
          className={cn(
            'cursor-pointer rounded-2xl border-2 min-h-[200px] flex flex-col items-center justify-center p-8 text-center transition-all',
            flipped
              ? 'border-blue-600 bg-blue-600'
              : 'border-[#E2E8F0] bg-white hover:border-blue-200 hover:shadow-sm'
          )}
          onClick={onCardFlip}
        >
          {!flipped ? (
            <>
              <p className="text-[#0F172A] text-base font-bold leading-snug">{card.front}</p>
              <p className="text-[#94A3B8] text-xs mt-3">Click to reveal answer</p>
            </>
          ) : (
            <>
              <p className="text-[11px] font-bold text-white/70 uppercase tracking-[0.15em] mb-3">Answer</p>
              <p className="text-white text-sm leading-relaxed">{card.back}</p>
            </>
          )}
        </motion.div>
        {flipped && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <button
              onClick={onCardAgain}
              className="flex-1 rounded-xl py-3 text-sm font-bold bg-white text-[#0F172A] hover:bg-[#F8FAFC] transition border border-[#E2E8F0]"
            >
              ↺ Again
            </button>
            <button
              onClick={onCardGotIt}
              className="flex-1 rounded-xl py-3 text-sm font-bold bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition"
            >
              ✓ Got it
            </button>
          </motion.div>
        )}
      </div>
    )
  }

  if (tab === 'concept_map') {
    const content = item.content as unknown as ConceptMapContent
    return <ConceptFlowMap content={content} onRetry={() => onGenerateContent('concept_map', true)} />
  }

  return null
}

function QuestionCard({
  question, showFeedback, lastFeedback, mcqSelected, currentAnswer, scoring,
  onAnswerChange, onSubmitRecall, onSubmitMCQ, onNext,
}: {
  question: Question
  showFeedback: boolean
  lastFeedback: QuizAnswer | null
  mcqSelected: number | null
  currentAnswer: string
  scoring: boolean
  onAnswerChange: (v: string) => void
  onSubmitRecall: () => void
  onSubmitMCQ: (i: number) => void
  onNext: () => void
}) {
  if (question.type === 'recall') {
    const content = question.content as unknown as RecallContent
    return (
      <div className="space-y-4">
        <div className="relative bg-white rounded-2xl border border-[#E2E8F0] p-5 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-2xl" />
          <p className="text-[11px] font-bold text-blue-600 uppercase tracking-[0.12em] mb-2">Active Recall</p>
          <p className="text-[#0F172A] font-semibold leading-snug">{content.prompt}</p>
        </div>

        {!showFeedback ? (
          <>
            <textarea
              rows={4}
              value={currentAnswer}
              onChange={e => onAnswerChange(e.target.value)}
              placeholder="Type your answer from memory…"
              className="w-full rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-4 py-3 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none transition"
            />
            <button
              onClick={onSubmitRecall}
              disabled={scoring || !currentAnswer.trim()}
              className="w-full rounded-xl py-3 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 transition flex items-center justify-center gap-2 active:scale-95"
            >
              {scoring ? <><Spinner className="w-4 h-4" /> Checking…</> : 'Submit answer →'}
            </button>
          </>
        ) : (
          <RecallFeedback answer={lastFeedback} idealAnswer={content.ideal_answer} onNext={onNext} />
        )}
      </div>
    )
  }

  if (question.type === 'mcq') {
    const content = question.content as unknown as MCQContent
    return (
      <div className="space-y-4">
        <div className="relative bg-white rounded-2xl border border-[#E2E8F0] p-5 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-sky-400 rounded-l-2xl" />
          <p className="text-[11px] font-bold text-sky-600 uppercase tracking-[0.12em] mb-2">Multiple Choice</p>
          <p className="text-[#0F172A] font-semibold leading-snug">{content.question}</p>
        </div>

        <div className="space-y-2">
          {content.options.map((option, i) => {
            let cls = 'border-[#E2E8F0] bg-white hover:border-blue-300 hover:bg-blue-50 text-[#0F172A]'
            if (showFeedback && mcqSelected !== null) {
              if (i === content.correct_index) cls = 'border-green-400 bg-green-50 text-green-800'
              else if (i === mcqSelected && i !== content.correct_index) cls = 'border-red-400 bg-red-50 text-red-800'
              else cls = 'border-[#F1F5F9] bg-[#F8FAFC] text-[#94A3B8] opacity-40'
            } else if (mcqSelected === i) {
              cls = 'border-blue-400 bg-blue-50 text-blue-800'
            }

            return (
              <button
                key={i}
                disabled={showFeedback}
                onClick={() => onSubmitMCQ(i)}
                className={cn('w-full text-left rounded-xl border px-4 py-3 text-sm transition', cls)}
              >
                <span className="text-[#94A3B8] font-bold mr-2">{String.fromCharCode(65 + i)}.</span>
                {option}
              </button>
            )
          })}
        </div>

        {showFeedback && (
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 space-y-2">
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-[0.1em]">Explanation</p>
            <p className="text-[#0F172A] text-sm leading-relaxed">{content.explanation}</p>
            <button
              onClick={onNext}
              className="w-full mt-2 rounded-xl py-2.5 text-sm font-bold bg-[#F0F4FF] text-[#0F172A] hover:bg-[#E8EEFF] transition border border-[#E2E8F0]"
            >
              Continue →
            </button>
          </div>
        )}
      </div>
    )
  }

  return null
}

function RecallFeedback({ answer, idealAnswer, onNext }: { answer: QuizAnswer | null; idealAnswer: string; onNext: () => void }) {
  if (!answer) return null
  const scoreConfig = {
    correct: { label: '✓ Correct',           cls: 'border-green-200 bg-green-50', head: 'text-green-700' },
    partial: { label: '◑ Partially correct',  cls: 'border-amber-200 bg-amber-50', head: 'text-amber-700' },
    wrong:   { label: '✗ Needs work',         cls: 'border-red-200 bg-red-50',     head: 'text-red-700' },
  }
  const cfg = scoreConfig[answer.score]

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', cfg.cls)}>
      <p className={cn('font-bold text-sm', cfg.head)}>{cfg.label}</p>

      {answer.feedback?.correct_parts?.length ? (
        <div>
          <p className="text-xs text-[#64748B] mb-1">You got right:</p>
          <ul className="space-y-0.5">
            {answer.feedback.correct_parts.map((p, i) => (
              <li key={i} className="text-green-700 text-xs flex gap-1.5"><span>✓</span>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.feedback?.missing_parts?.length ? (
        <div>
          <p className="text-xs text-[#64748B] mb-1">You missed:</p>
          <ul className="space-y-0.5">
            {answer.feedback.missing_parts.map((p, i) => (
              <li key={i} className="text-red-600 text-xs flex gap-1.5"><span>✗</span>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.feedback?.source_quote && (
        <div className="border-l-2 border-slate-300 pl-3">
          <p className="text-[#64748B] text-xs italic">{answer.feedback.source_quote}</p>
        </div>
      )}

      <div className="border-l-2 border-[#E2E8F0] pl-3 py-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#94A3B8] mb-1">Ideal answer</p>
        <p className="text-[#0F172A] text-xs leading-relaxed">{idealAnswer}</p>
      </div>

      <button
        onClick={onNext}
        className="w-full rounded-xl py-2.5 text-sm font-bold bg-white text-[#0F172A] hover:bg-[#F8FAFC] transition border border-[#E2E8F0]"
      >
        Continue →
      </button>
    </div>
  )
}
