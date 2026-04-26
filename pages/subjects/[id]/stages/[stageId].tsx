import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { RequireAuth } from '@/components/RequireAuth'
import { Spinner } from '@/components/Spinner'
import { apiJson } from '@/lib/apiFetch'
import { cn } from '@/lib/utils'
import type {
  StudyStage, Topic, GeneratedItem, Question,
  SummaryContent, FlashcardsContent, ConceptMapContent,
  MCQContent, RecallContent, MasteryLevel, MaterialType,
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

      const stageTopics = subjectData.topics.filter((t: Topic) =>
        (stage.topic_ids ?? []).includes(t.id)
      )

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
      } catch { /* silently fail — user can click tab to retry */ }
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
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Spinner className="text-blue-500 w-5 h-5" />
    </div>
  )
  if (!data) return null

  const { stage, topics, generated } = data
  const topicLabel = topics.map(t => t.name).join(', ')

  return (
    <>
      <Head><title>{stage.name} — fuckexam</title></Head>
      <div className="min-h-screen bg-slate-50">
        {/* Header */}
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <Link href={`/subjects/${subjectId}/path`} className="text-slate-400 hover:text-slate-700 text-sm transition">←</Link>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 truncate">{stage.subjects.name}</p>
              <p className="text-sm font-semibold text-slate-900 truncate">{stage.name}</p>
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-6">

          {/* STUDY MODE */}
          {mode === 'study' && (
            <div className="space-y-5">
              {/* Tabs */}
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
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
                      'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition capitalize',
                      activeTab === tab
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {tab === 'concept_map' ? 'Map' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Content area */}
              <div className="min-h-[320px]">
                {generating && !generated.find(g => g.type === activeTab) ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3">
                    <Spinner className="text-blue-500 w-5 h-5" />
                    <p className="text-slate-500 text-sm">Generating {activeTab.replace('_', ' ')}…</p>
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

              {/* Test Me */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4 shadow-sm">
                <div>
                  <p className="text-slate-900 text-sm font-medium">Test yourself on this stage</p>
                  <p className="text-slate-400 text-xs mt-0.5">Active recall + quiz</p>
                </div>
                <button
                  onClick={startQuiz}
                  disabled={generating}
                  className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
                >
                  Test me →
                </button>
              </div>
            </div>
          )}

          {/* QUIZ MODE */}
          {mode === 'quiz' && (
            <div className="space-y-5">
              {generating ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3">
                  <Spinner className="text-blue-500 w-5 h-5" />
                  <p className="text-slate-500 text-sm">Generating questions…</p>
                </div>
              ) : questions.length > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">Question {qIndex + 1} of {questions.length}</p>
                    <button onClick={() => setMode('study')} className="text-xs text-slate-400 hover:text-slate-700 transition">
                      Exit quiz
                    </button>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${((qIndex) / questions.length) * 100}%` }}
                    />
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
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                <p className="text-4xl mb-3">
                  {correctCount + partialCount * 0.5 >= answers.length * 0.7 ? '🎉' : '📚'}
                </p>
                <p className="text-slate-900 font-bold text-xl mb-1">
                  {correctCount} / {answers.length} correct
                </p>
                <p className="text-slate-500 text-sm">
                  {partialCount > 0 && `${partialCount} partial · `}
                  {answers.filter(a => a.score === 'wrong').length} missed
                </p>
              </div>

              {answers.filter(a => a.score !== 'correct').length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Review</p>
                  <div className="space-y-2">
                    {answers.filter(a => a.score !== 'correct').map(a => {
                      const q = questions.find(q => q.id === a.question_id)
                      if (!q) return null
                      return (
                        <div key={a.question_id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={a.score === 'partial' ? 'text-yellow-600' : 'text-red-600'}>
                              {a.score === 'partial' ? '◑' : '✗'}
                            </span>
                            <p className="text-slate-900 font-medium">
                              {q.type === 'recall'
                                ? (q.content as unknown as RecallContent).prompt
                                : (q.content as unknown as MCQContent).question}
                            </p>
                          </div>
                          {a.feedback?.missing_parts?.length ? (
                            <p className="text-slate-500 text-xs">Missed: {a.feedback.missing_parts.join(', ')}</p>
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
                  <span className="text-slate-500 text-sm">Saving results…</span>
                </div>
              ) : (
                <button
                  onClick={() => router.push(`/subjects/${subjectId}/path`)}
                  className="w-full rounded-lg px-4 py-2.5 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  Continue →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function renderInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-900 font-semibold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-blue-600 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
}

const NODE_TYPE_CLASSES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  concept:      { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-800',    badge: 'bg-blue-100 text-blue-600' },
  definition:   { bg: 'bg-violet-50',  border: 'border-violet-200',  text: 'text-violet-800',  badge: 'bg-violet-100 text-violet-600' },
  process:      { bg: 'bg-sky-50',     border: 'border-sky-200',     text: 'text-sky-800',     badge: 'bg-sky-100 text-sky-600' },
  solution:     { bg: 'bg-green-50',   border: 'border-green-200',   text: 'text-green-800',   badge: 'bg-green-100 text-green-600' },
  problem:      { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-800',     badge: 'bg-red-100 text-red-600' },
  exam_trap:    { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-800',   badge: 'bg-amber-100 text-amber-600' },
  limitation:   { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-800',  badge: 'bg-orange-100 text-orange-600' },
  comparison:   { bg: 'bg-cyan-50',    border: 'border-cyan-200',    text: 'text-cyan-800',    badge: 'bg-cyan-100 text-cyan-600' },
  evidence:     { bg: 'bg-teal-50',    border: 'border-teal-200',    text: 'text-teal-800',    badge: 'bg-teal-100 text-teal-600' },
  formula:      { bg: 'bg-purple-50',  border: 'border-purple-200',  text: 'text-purple-800',  badge: 'bg-purple-100 text-purple-600' },
  example:      { bg: 'bg-slate-50',   border: 'border-slate-200',   text: 'text-slate-700',   badge: 'bg-slate-100 text-slate-500' },
  code_example: { bg: 'bg-slate-100',  border: 'border-slate-200',   text: 'text-emerald-700', badge: 'bg-slate-200 text-emerald-600' },
}
function nodeTypeClasses(type: string) {
  return NODE_TYPE_CLASSES[type] ?? NODE_TYPE_CLASSES.concept
}

function SectionLabel({ text }: { text: string }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{text}</p>
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
          <SectionLabel text="Learn this in 5 min" />
          <ul className="space-y-2">
            {content.quickOverview.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.bigIdea && (
        <div>
          <SectionLabel text="Big Idea" />
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3">
            <p className="text-blue-800 text-sm leading-relaxed">{content.bigIdea}</p>
          </div>
        </div>
      )}

      {content.keyConcepts?.length > 0 && (
        <div>
          <SectionLabel text="Key Concepts" />
          <div className="space-y-2">
            {content.keyConcepts.map((kc, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-slate-900 font-semibold text-sm">{kc.term}</p>
                <p className="text-slate-600 text-sm mt-1 leading-relaxed">{kc.explanation}</p>
                <p className="text-blue-600 text-xs mt-1.5 italic">{kc.whyItMatters}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.ideaConnections?.length > 0 && (
        <div>
          <SectionLabel text="How It Connects" />
          <div className="space-y-2">
            {content.ideaConnections.map((conn, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <span className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-slate-700 font-medium text-xs">{conn.from}</span>
                <span className="text-slate-400 text-xs">── {conn.relationship} ──▶</span>
                <span className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-slate-700 font-medium text-xs">{conn.to}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.examTraps?.length > 0 && (
        <div>
          <SectionLabel text="Exam Traps" />
          <div className="space-y-2">
            {content.examTraps.map((trap, i) => (
              <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 border-l-[3px] border-l-amber-400">
                <p className="text-red-600 text-sm">✗ {trap.trap}</p>
                <p className="text-green-600 text-sm mt-1.5">✓ {trap.correction}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {content.quickCheck?.length > 0 && (
        <div>
          <SectionLabel text="Quick Check" />
          <div className="space-y-2">
            {content.quickCheck.map((qc, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-slate-900 text-sm font-medium">{qc.question}</p>
                {revealedChecks.has(i) ? (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-slate-600 text-sm mt-2 leading-relaxed"
                  >
                    {qc.answer}
                  </motion.p>
                ) : (
                  <button
                    onClick={() => toggleCheck(i)}
                    className="text-blue-600 text-xs mt-2 hover:text-blue-700 transition"
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
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition"
          >
            Detailed Notes <span>{showNotes ? '▲' : '▾'}</span>
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
        <p className="text-slate-500 text-sm">Concept map could not be loaded.</p>
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
      <div className="rounded-xl bg-gradient-to-r from-blue-50 to-violet-50 border border-blue-200 px-4 py-3">
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
                  <div key={id} className={cn('rounded-xl border px-4 py-3', cls.bg, cls.border)}>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls.badge)}>
                      {node.type.replace(/_/g, ' ')}
                    </span>
                    <p className={cn('font-semibold mt-1.5', cls.text,
                      (node as any).importance === 'primary' ? 'text-sm font-bold' :
                      (node as any).importance === 'supporting' ? 'text-xs opacity-70' : 'text-sm'
                    )}>{node.label}</p>
                    <p className="text-slate-500 text-xs mt-1 leading-relaxed">{node.detail}</p>
                  </div>
                )
              })}
            </div>

            {connector && (
              <div className="flex flex-col items-center py-1.5 gap-0.5">
                <div className="w-px h-3 bg-slate-300" />
                <span className="rounded-full bg-white border border-slate-200 px-2.5 py-0.5 text-slate-500 text-[11px]">
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
          <SectionLabel text="Also see" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {orphans.map(node => {
              const cls = nodeTypeClasses(node.type)
              return (
                <div key={node.id} className={cn('rounded-xl border px-4 py-3', cls.bg, cls.border)}>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls.badge)}>
                    {node.type.replace(/_/g, ' ')}
                  </span>
                  <p className={cn('font-semibold mt-1.5', cls.text,
                    (node as any).importance === 'primary' ? 'text-sm font-bold' :
                    (node as any).importance === 'supporting' ? 'text-xs opacity-70' : 'text-sm'
                  )}>{node.label}</p>
                  <p className="text-slate-500 text-xs mt-1 leading-relaxed">{node.detail}</p>
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
        <pre key={`code-${si}`} className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 text-xs text-blue-700 font-mono overflow-x-auto whitespace-pre-wrap">
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
              <span className={`w-1 rounded-full shrink-0 ${isH3 ? 'h-4 bg-blue-500' : 'h-5 bg-violet-500'}`} />
              <h3 className="text-slate-900 font-semibold text-sm">{heading}</h3>
            </div>
            {rest && (
              <p className="text-slate-600 text-sm leading-relaxed"
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
              <li key={j} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="mt-[6px] w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                <span dangerouslySetInnerHTML={{ __html: renderInline(line.replace(/^[-*]\s+/, '')) }} />
              </li>
            ))}
          </ul>
        )
        return
      }

      elements.push(
        <p key={key} className="text-slate-600 text-sm leading-relaxed"
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
        <p className="text-slate-400 text-sm">Switch tabs to generate content</p>
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

    if (!card) return <p className="text-slate-400 text-sm text-center">No flashcards generated.</p>

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">Card {idx + 1} of {cards.length}</p>
          <div className="flex gap-0.5">
            {cards.map((_, ci) => (
              <span key={ci} className={cn('w-1.5 h-1.5 rounded-full transition-colors', ci === idx ? 'bg-blue-500' : 'bg-slate-300')} />
            ))}
          </div>
        </div>
        <motion.div
          key={`${idx}-${flipped}`}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15 }}
          className={cn(
            'cursor-pointer rounded-xl border min-h-[180px] flex flex-col items-center justify-center p-6 text-center transition-colors',
            flipped
              ? 'border-blue-300 bg-blue-50'
              : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm'
          )}
          onClick={onCardFlip}
        >
          {!flipped ? (
            <>
              <p className="text-slate-900 text-base font-semibold leading-snug">{card.front}</p>
              <p className="text-slate-400 text-xs mt-3">tap to reveal →</p>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-3">Answer</p>
              <p className="text-slate-700 text-sm leading-relaxed">{card.back}</p>
            </>
          )}
        </motion.div>
        {flipped && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <button onClick={onCardAgain} className="flex-1 rounded-lg py-2.5 text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition border border-slate-200">
              ↺ Again
            </button>
            <button onClick={onCardGotIt} className="flex-1 rounded-lg py-2.5 text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 transition">
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-2">Active recall</p>
          <p className="text-slate-900 font-medium">{content.prompt}</p>
        </div>

        {!showFeedback ? (
          <>
            <textarea
              rows={4}
              value={currentAnswer}
              onChange={e => onAnswerChange(e.target.value)}
              placeholder="Type your answer from memory…"
              className="w-full rounded-xl bg-white border border-slate-300 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <button
              onClick={onSubmitRecall}
              disabled={scoring || !currentAnswer.trim()}
              className="w-full rounded-lg py-2.5 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              {scoring ? <><Spinner className="w-4 h-4" /> Checking…</> : 'Submit →'}
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-2">Multiple choice</p>
          <p className="text-slate-900 font-medium">{content.question}</p>
        </div>

        <div className="space-y-2">
          {content.options.map((option, i) => {
            let style = 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            if (showFeedback && mcqSelected !== null) {
              if (i === content.correct_index) style = 'border-green-400 bg-green-50 text-green-700'
              else if (i === mcqSelected && i !== content.correct_index) style = 'border-red-400 bg-red-50 text-red-700'
              else style = 'border-slate-100 bg-slate-50 opacity-50'
            } else if (mcqSelected === i) {
              style = 'border-blue-400 bg-blue-50'
            }

            return (
              <button
                key={i}
                disabled={showFeedback}
                onClick={() => onSubmitMCQ(i)}
                className={cn(
                  'w-full text-left rounded-lg border px-4 py-3 text-sm text-slate-900 transition shadow-sm',
                  style
                )}
              >
                <span className="text-slate-400 mr-2">{String.fromCharCode(65 + i)}.</span>
                {option}
              </button>
            )
          })}
        </div>

        {showFeedback && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 shadow-sm">
            <p className="text-xs font-medium text-slate-500">Explanation</p>
            <p className="text-slate-600 text-sm">{content.explanation}</p>
            <button onClick={onNext} className="w-full mt-2 rounded-lg py-2 text-sm font-medium bg-slate-100 text-slate-900 hover:bg-slate-200 transition">
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
    correct: { color: 'text-green-600', label: '✓ Correct', border: 'border-green-200 bg-green-50' },
    partial: { color: 'text-yellow-600', label: '◑ Partially correct', border: 'border-yellow-200 bg-yellow-50' },
    wrong:   { color: 'text-red-600',   label: '✗ Needs work', border: 'border-red-200 bg-red-50' },
  }
  const cfg = scoreConfig[answer.score]

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', cfg.border)}>
      <p className={cn('font-medium text-sm', cfg.color)}>{cfg.label}</p>

      {answer.feedback?.correct_parts?.length ? (
        <div>
          <p className="text-xs text-slate-400 mb-1">You got right:</p>
          <ul className="space-y-0.5">
            {answer.feedback.correct_parts.map((p, i) => (
              <li key={i} className="text-green-700 text-xs flex gap-1.5"><span>✓</span>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.feedback?.missing_parts?.length ? (
        <div>
          <p className="text-xs text-slate-400 mb-1">You missed:</p>
          <ul className="space-y-0.5">
            {answer.feedback.missing_parts.map((p, i) => (
              <li key={i} className="text-red-700 text-xs flex gap-1.5"><span>✗</span>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.feedback?.source_quote && (
        <div className="border-l-2 border-slate-300 pl-3">
          <p className="text-slate-500 text-xs italic">{answer.feedback.source_quote}</p>
        </div>
      )}

      <button onClick={onNext} className="w-full rounded-lg py-2 text-sm font-medium bg-slate-100 text-slate-900 hover:bg-slate-200 transition">
        Continue →
      </button>
    </div>
  )
}
