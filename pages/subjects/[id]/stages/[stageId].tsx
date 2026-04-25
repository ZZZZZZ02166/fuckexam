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
  MCQContent, RecallContent, MasteryLevel,
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

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizAnswer[]>([])
  const [currentAnswer, setCurrentAnswer] = useState('')
  const [scoring, setScoring] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [lastFeedback, setLastFeedback] = useState<QuizAnswer | null>(null)
  const [mcqSelected, setMcqSelected] = useState<number | null>(null)
  const [submittingResults, setSubmittingResults] = useState(false)

  // Flashcard state
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    if (!stageId) return
    loadStage()
  }, [stageId])

  async function loadStage() {
    setLoading(true)
    try {
      // Load stage + topics from subject data
      const subjectData = await apiJson<any>(`/api/subjects/${subjectId}`)
      const stage = subjectData.stages.find((s: StudyStage) => s.id === stageId)
      if (!stage) { router.replace(`/subjects/${subjectId}/path`); return }

      const stageTopics = subjectData.topics.filter((t: Topic) =>
        (stage.topic_ids ?? []).includes(t.id)
      )

      // Load cached generated items + questions in parallel
      const [genRes, qRes] = await Promise.allSettled([
        apiJson<GeneratedItem[]>(`/api/stages/${stageId}/content-list`).catch(() => []),
        apiJson<Question[]>(`/api/stages/${stageId}/quiz`).catch(() => []),
      ])

      setData({
        stage: { ...stage, subjects: { name: subjectData.subject.name, exam_format_text: subjectData.subject.exam_format_text, user_id: subjectData.subject.user_id } },
        topics: stageTopics,
        generated: genRes.status === 'fulfilled' ? genRes.value : [],
        questions: qRes.status === 'fulfilled' ? qRes.value : [],
      })
    } finally {
      setLoading(false)
    }
  }

  async function generateContent(type: Tab) {
    if (!data) return
    const existing = data.generated.find(g => g.type === type)
    if (existing) return
    setGenerating(true)
    try {
      const item = await apiJson<GeneratedItem>(`/api/stages/${stageId}/content`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      })
      setData(prev => prev ? { ...prev, generated: [...prev.generated, item] } : prev)
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
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <Spinner className="text-indigo-400 w-5 h-5" />
    </div>
  )
  if (!data) return null

  const { stage, topics, generated } = data
  const topicLabel = topics.map(t => t.name).join(', ')

  return (
    <>
      <Head><title>{stage.name} — fuckexam</title></Head>
      <div className="min-h-screen bg-zinc-950">
        {/* Header */}
        <div className="border-b border-zinc-800 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <Link href={`/subjects/${subjectId}/path`} className="text-zinc-500 hover:text-zinc-300 text-sm transition">←</Link>
            <div className="min-w-0">
              <p className="text-xs text-zinc-500 truncate">{stage.subjects.name}</p>
              <p className="text-sm font-semibold text-white truncate">{stage.name}</p>
            </div>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-6">

          {/* STUDY MODE */}
          {mode === 'study' && (
            <div className="space-y-5">
              {/* Tabs */}
              <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
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
                        ? 'bg-zinc-700 text-white'
                        : 'text-zinc-400 hover:text-zinc-300'
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
                    <Spinner className="text-indigo-400 w-5 h-5" />
                    <p className="text-zinc-400 text-sm">Generating {activeTab.replace('_', ' ')}…</p>
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
                  />
                )}
              </div>

              {/* Test Me */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-white text-sm font-medium">Test yourself on this stage</p>
                  <p className="text-zinc-500 text-xs mt-0.5">Active recall + quiz</p>
                </div>
                <button
                  onClick={startQuiz}
                  disabled={generating}
                  className="shrink-0 rounded-lg px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition"
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
                  <Spinner className="text-indigo-400 w-5 h-5" />
                  <p className="text-zinc-400 text-sm">Generating questions…</p>
                </div>
              ) : questions.length > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-zinc-500">Question {qIndex + 1} of {questions.length}</p>
                    <button onClick={() => setMode('study')} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                      Exit quiz
                    </button>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all"
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
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
                <p className="text-4xl mb-3">
                  {correctCount + partialCount * 0.5 >= answers.length * 0.7 ? '🎉' : '📚'}
                </p>
                <p className="text-white font-bold text-xl mb-1">
                  {correctCount} / {answers.length} correct
                </p>
                <p className="text-zinc-400 text-sm">
                  {partialCount > 0 && `${partialCount} partial · `}
                  {answers.filter(a => a.score === 'wrong').length} missed
                </p>
              </div>

              {answers.filter(a => a.score !== 'correct').length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Review</p>
                  <div className="space-y-2">
                    {answers.filter(a => a.score !== 'correct').map(a => {
                      const q = questions.find(q => q.id === a.question_id)
                      if (!q) return null
                      return (
                        <div key={a.question_id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={a.score === 'partial' ? 'text-yellow-400' : 'text-red-400'}>
                              {a.score === 'partial' ? '◑' : '✗'}
                            </span>
                            <p className="text-white font-medium">
                              {q.type === 'recall'
                                ? (q.content as unknown as RecallContent).prompt
                                : (q.content as unknown as MCQContent).question}
                            </p>
                          </div>
                          {a.feedback?.missing_parts?.length ? (
                            <p className="text-zinc-400 text-xs">Missed: {a.feedback.missing_parts.join(', ')}</p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {submittingResults ? (
                <div className="flex items-center justify-center gap-2 py-2">
                  <Spinner className="text-indigo-400 w-4 h-4" />
                  <span className="text-zinc-400 text-sm">Saving results…</span>
                </div>
              ) : (
                <button
                  onClick={() => router.push(`/subjects/${subjectId}/path`)}
                  className="w-full rounded-lg px-4 py-2.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition"
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

function TabContent({
  tab, item, cardIndex, flipped, onCardFlip, onCardGotIt, onCardAgain
}: {
  tab: Tab
  item: GeneratedItem | null
  cardIndex: number
  flipped: boolean
  onCardFlip: () => void
  onCardGotIt: () => void
  onCardAgain: () => void
}) {
  if (!item) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-zinc-500 text-sm">Click the tab to generate</p>
      </div>
    )
  }

  if (tab === 'summary') {
    const content = item.content as unknown as SummaryContent
    const rendered = content.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    return (
      <div className="space-y-4">
        <div
          className="text-zinc-300 text-sm leading-relaxed prose prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
        {content.key_terms?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {content.key_terms.map(term => (
              <span key={term} className="rounded-md bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 px-2 py-0.5 text-xs">
                {term}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (tab === 'flashcards') {
    const content = item.content as unknown as FlashcardsContent
    const cards = content.cards ?? []
    const idx = cardIndex % cards.length
    const card = cards[idx]

    if (!card) return <p className="text-zinc-500 text-sm text-center">No flashcards generated.</p>

    return (
      <div className="space-y-4">
        <p className="text-xs text-zinc-500 text-center">Card {idx + 1} of {cards.length}</p>
        <motion.div
          key={`${idx}-${flipped}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="cursor-pointer rounded-xl border border-zinc-700 bg-zinc-900 min-h-[160px] flex items-center justify-center p-6 text-center"
          onClick={onCardFlip}
        >
          {!flipped ? (
            <p className="text-white text-base font-medium">{card.front}</p>
          ) : (
            <p className="text-zinc-300 text-sm leading-relaxed">{card.back}</p>
          )}
        </motion.div>
        {!flipped ? (
          <p className="text-zinc-600 text-xs text-center">Tap to reveal</p>
        ) : (
          <div className="flex gap-3">
            <button onClick={onCardAgain} className="flex-1 rounded-lg py-2 text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition">
              ↺ Again
            </button>
            <button onClick={onCardGotIt} className="flex-1 rounded-lg py-2 text-sm font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition">
              ✓ Got it
            </button>
          </div>
        )}
      </div>
    )
  }

  if (tab === 'concept_map') {
    const content = item.content as unknown as ConceptMapContent
    return (
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 text-sm font-mono overflow-auto">
        <p className="text-indigo-400 font-bold mb-2">{content.root}</p>
        {(content.tree ?? []).map((node, i) => (
          <div key={i} className="ml-2 mb-2">
            <p className="text-white">├── {node.label}</p>
            {node.detail && <p className="text-zinc-400 ml-6 text-xs">{node.detail}</p>}
            {node.children?.map((child, j) => (
              <div key={j} className="ml-4">
                <p className="text-zinc-300">│   └── {child.label}</p>
                {child.detail && <p className="text-zinc-500 ml-10 text-xs">{child.detail}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-2">Active recall</p>
          <p className="text-white font-medium">{content.prompt}</p>
        </div>

        {!showFeedback ? (
          <>
            <textarea
              rows={4}
              value={currentAnswer}
              onChange={e => onAnswerChange(e.target.value)}
              placeholder="Type your answer from memory…"
              className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <button
              onClick={onSubmitRecall}
              disabled={scoring || !currentAnswer.trim()}
              className="w-full rounded-lg py-2.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition flex items-center justify-center gap-2"
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-2">Multiple choice</p>
          <p className="text-white font-medium">{content.question}</p>
        </div>

        <div className="space-y-2">
          {content.options.map((option, i) => {
            let style = 'border-zinc-700 bg-zinc-900 hover:border-zinc-600 hover:bg-zinc-800'
            if (showFeedback && mcqSelected !== null) {
              if (i === content.correct_index) style = 'border-green-500 bg-green-500/15 text-green-300'
              else if (i === mcqSelected && i !== content.correct_index) style = 'border-red-500 bg-red-500/15 text-red-300'
              else style = 'border-zinc-800 bg-zinc-900 opacity-50'
            } else if (mcqSelected === i) {
              style = 'border-indigo-500 bg-indigo-500/15'
            }

            return (
              <button
                key={i}
                disabled={showFeedback}
                onClick={() => onSubmitMCQ(i)}
                className={cn(
                  'w-full text-left rounded-lg border px-4 py-3 text-sm text-white transition',
                  style
                )}
              >
                <span className="text-zinc-500 mr-2">{String.fromCharCode(65 + i)}.</span>
                {option}
              </button>
            )
          })}
        </div>

        {showFeedback && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-2">
            <p className="text-xs font-medium text-zinc-400">Explanation</p>
            <p className="text-zinc-300 text-sm">{content.explanation}</p>
            <button onClick={onNext} className="w-full mt-2 rounded-lg py-2 text-sm font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition">
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
    correct: { color: 'text-green-400', label: '✓ Correct', border: 'border-green-500/30 bg-green-500/10' },
    partial: { color: 'text-yellow-400', label: '◑ Partially correct', border: 'border-yellow-500/30 bg-yellow-500/10' },
    wrong:   { color: 'text-red-400',   label: '✗ Needs work', border: 'border-red-500/30 bg-red-500/10' },
  }
  const cfg = scoreConfig[answer.score]

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', cfg.border)}>
      <p className={cn('font-medium text-sm', cfg.color)}>{cfg.label}</p>

      {answer.feedback?.correct_parts?.length ? (
        <div>
          <p className="text-xs text-zinc-500 mb-1">You got right:</p>
          <ul className="space-y-0.5">
            {answer.feedback.correct_parts.map((p, i) => (
              <li key={i} className="text-green-300 text-xs flex gap-1.5"><span>✓</span>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.feedback?.missing_parts?.length ? (
        <div>
          <p className="text-xs text-zinc-500 mb-1">You missed:</p>
          <ul className="space-y-0.5">
            {answer.feedback.missing_parts.map((p, i) => (
              <li key={i} className="text-red-300 text-xs flex gap-1.5"><span>✗</span>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.feedback?.source_quote && (
        <div className="border-l-2 border-zinc-600 pl-3">
          <p className="text-zinc-400 text-xs italic">{answer.feedback.source_quote}</p>
        </div>
      )}

      <button onClick={onNext} className="w-full rounded-lg py-2 text-sm font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition">
        Continue →
      </button>
    </div>
  )
}
