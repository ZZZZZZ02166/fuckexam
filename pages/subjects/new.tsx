import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { RequireAuth } from '@/components/RequireAuth'
import { Spinner } from '@/components/Spinner'
import { supabase } from '@/lib/supabase/client'
import { apiJson } from '@/lib/apiFetch'
import { useAuth } from '../_app'
import { cn } from '@/lib/utils'
import type { UploadMaterialType } from '@/types/database'

type Step = 'details' | 'upload' | 'processing' | 'done'

interface FileEntry {
  id: string
  file: File
  materialType: UploadMaterialType
}

interface ProcessingStatus {
  label: string
  done: boolean
}

const MATERIAL_SECTIONS: Array<{
  type: UploadMaterialType
  label: string
  description: string
  required?: boolean
  icon: string
}> = [
  {
    type: 'course_lecture_material',
    label: 'Lecture material',
    description: 'Builds the study path, summaries, concepts, and flashcards.',
    required: true,
    icon: '📖',
  },
  {
    type: 'tutorial_material',
    label: 'Tutorial / problem set',
    description: 'Adds applied examples and practice questions.',
    icon: '🧩',
  },
  {
    type: 'past_exam_questions',
    label: 'Past exam questions',
    description: 'Helps match question style and difficulty.',
    icon: '📝',
  },
  {
    type: 'exam_solutions_marking_guide',
    label: 'Solutions / marking guide',
    description: 'Improves full-mark answers and marking logic.',
    icon: '✅',
  },
]

export default function NewSubjectPage() {
  return (
    <RequireAuth>
      <NewSubjectForm />
    </RequireAuth>
  )
}

function NewSubjectForm() {
  const router = useRouter()
  const { user } = useAuth()

  // Dynamically create a file input on demand — never kept in the DOM,
  // avoids browser security restrictions and Playwright modal detection.
  function pickFile(materialType: UploadMaterialType) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) addFile(file, materialType)
    }
    input.click()
  }

  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [examFormat, setExamFormat] = useState('')
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<ProcessingStatus[]>([])
  const [previewEntry, setPreviewEntry] = useState<FileEntry | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  function addStatus(label: string) {
    setStatuses(prev => [...prev, { label, done: false }])
  }
  function completeStatus() {
    setStatuses(prev => {
      const next = [...prev]
      if (next.length) next[next.length - 1] = { ...next[next.length - 1], done: true }
      return next
    })
  }

  function addFile(file: File, materialType: UploadMaterialType) {
    setFileEntries(prev => [
      ...prev,
      { id: `${Date.now()}_${Math.random()}`, file, materialType },
    ])
  }

  function removeEntry(id: string) {
    if (previewEntry?.id === id) closePreview()
    setFileEntries(prev => prev.filter(e => e.id !== id))
  }

  function openPreview(entry: FileEntry) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(entry.file))
    setPreviewEntry(entry)
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPreviewEntry(null)
  }

  const hasLectureFile = fileEntries.some(e => e.materialType === 'course_lecture_material')
  const totalFiles = fileEntries.length

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setStep('upload')
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!hasLectureFile || !user) return
    setError('')
    setStep('processing')
    setStatuses([])

    let subject: { id: string } | null = null

    try {
      addStatus('Creating subject…')
      subject = await apiJson<{ id: string }>('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ name, exam_date: examDate || undefined, exam_format_text: examFormat || undefined }),
      })
      completeStatus()
    } catch (err: any) {
      setError(err.message ?? 'Failed to create subject')
      setStep('upload')
      return
    }

    const ordered = [...fileEntries].sort((a, b) =>
      a.materialType === 'course_lecture_material' ? -1 : b.materialType === 'course_lecture_material' ? 1 : 0
    )

    const fileErrors: string[] = []

    for (const entry of ordered) {
      try {
        addStatus(`Uploading ${entry.file.name}…`)
        const storagePath = `${user.id}/${Date.now()}_${entry.file.name}`
        const { error: uploadErr } = await supabase.storage
          .from('materials')
          .upload(storagePath, entry.file, { contentType: entry.file.type })
        if (uploadErr) throw new Error(uploadErr.message)
        completeStatus()

        addStatus(`Processing ${entry.file.name}…`)
        await apiJson('/api/process-material', {
          method: 'POST',
          body: JSON.stringify({
            subject_id: subject.id,
            storage_path: storagePath,
            file_name: entry.file.name,
            material_type: entry.materialType,
          }),
        })
        completeStatus()
      } catch (err: any) {
        completeStatus()
        fileErrors.push(`${entry.file.name}: ${err.message ?? 'processing failed'}`)
      }
    }

    if (fileErrors.length > 0) {
      setError(`Some files failed to process: ${fileErrors.join('; ')}`)
    }

    try {
      addStatus('Building your study path from all materials…')
      await apiJson(`/api/subjects/${subject!.id}/build-path`, { method: 'POST' })
      completeStatus()
    } catch (err: any) {
      completeStatus()
      setError((fileErrors.length > 0 ? `${fileErrors.join('; ')}; ` : '') + `Study path generation failed: ${err.message}`)
      setStep('upload')
      return
    }

    setStep('done')
    setTimeout(() => router.push(`/subjects/${subject!.id}/path`), 800)
  }

  return (
    <>
      <Head><title>New subject — fuckexam</title></Head>
      <div className="min-h-screen bg-[#F0F4FF]">
        {/* Nav */}
        <div className="bg-white/80 backdrop-blur border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
          <div className="max-w-6xl mx-auto">
            <button
              onClick={() => router.push('/')}
              className="text-slate-400 hover:text-slate-700 text-sm flex items-center gap-1.5 transition font-medium"
            >
              ← Dashboard
            </button>
          </div>
        </div>

        <div className={cn('mx-auto px-4 py-10', step === 'upload' ? 'max-w-6xl' : 'max-w-xl')}>
          <h1 className="text-[28px] font-extrabold text-[#0F172A] mb-1 tracking-tight">New subject</h1>

          {/* ── Details step ── */}
          {step === 'details' && (
            <>
              <p className="text-[#64748B] text-sm mb-8">Tell us about the subject and your exam.</p>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-[#0F172A] mb-1.5">Subject name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Computer Networks"
                    className="w-full rounded-xl bg-white border border-[#E2E8F0] px-4 py-3 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#0F172A] mb-1.5">
                    Exam date <span className="text-[#94A3B8] font-normal">(optional)</span>
                  </label>
                  <input
                    type="date"
                    value={examDate}
                    onChange={e => setExamDate(e.target.value)}
                    className="w-full rounded-xl bg-white border border-[#E2E8F0] px-4 py-3 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#0F172A] mb-1.5">
                    Exam format
                    <span className="text-[#94A3B8] font-normal ml-1.5">(optional but helps)</span>
                  </label>
                  <textarea
                    rows={3}
                    value={examFormat}
                    onChange={e => setExamFormat(e.target.value)}
                    placeholder="e.g. 2-hour written, closed-book, 30% MCQ + 50% short answer + 20% problem-solving"
                    className="w-full rounded-xl bg-white border border-[#E2E8F0] px-4 py-3 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm resize-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="w-full rounded-xl px-4 py-3 text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm mt-2"
                >
                  Next: upload materials →
                </button>
              </form>
            </>
          )}

          {/* ── Upload step — two-column split ── */}
          {step === 'upload' && (
            <form onSubmit={handleUpload}>
              {/* Full-width subject header */}
              <div className="bg-white rounded-2xl border border-[#E2E8F0] px-5 py-4 flex items-center justify-between shadow-sm mb-5">
                <div>
                  <p className="font-bold text-[#0F172A] text-[15px] leading-tight">{name}</p>
                  {examDate ? (
                    <p className="text-sm text-[#64748B] mt-0.5">
                      Exam: {new Date(examDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  ) : (
                    <p className="text-xs text-[#94A3B8] mt-0.5">Upload your course materials below</p>
                  )}
                </div>
                {totalFiles > 0 && (
                  <span className="shrink-0 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 ml-4">
                    {totalFiles} file{totalFiles !== 1 ? 's' : ''} added
                  </span>
                )}
              </div>

              {/* Two-column: left = cards, right = preview */}
              <div className="grid grid-cols-[1fr_360px] gap-5 items-stretch">

                {/* ── LEFT: section cards ── */}
                <div className="flex flex-col gap-4">
                  {/* Rule callout */}
                  <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 flex gap-2.5 items-start">
                    <span className="text-indigo-400 text-sm mt-0.5 shrink-0">💡</span>
                    <p className="text-sm text-indigo-800 leading-relaxed">
                      <span className="font-bold">Simple rule: </span>
                      Lecture files build the study path. The other files improve practice, Answer Coach, and exam-style questions.
                    </p>
                  </div>

                  {/* Section cards */}
                  <div className="space-y-2.5">
                    {MATERIAL_SECTIONS.map((section, index) => {
                      const sectionFiles = fileEntries.filter(e => e.materialType === section.type)
                      const hasFiles = sectionFiles.length > 0

                      return (
                        <div
                          key={section.type}
                          className={cn(
                            'rounded-2xl border bg-white shadow-sm overflow-hidden transition-all',
                            hasFiles
                              ? section.required ? 'border-blue-200' : 'border-slate-200'
                              : 'border-[#E2E8F0]'
                          )}
                        >
                          <div className="flex items-center gap-3.5 px-4 py-3.5">
                            <div className={cn(
                              'w-8 h-8 rounded-xl flex items-center justify-center font-extrabold text-sm shrink-0 transition-all',
                              hasFiles
                                ? 'bg-green-100 text-green-700'
                                : section.required
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-[#F1F5F9] text-[#94A3B8]'
                            )}>
                              {hasFiles ? '✓' : index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-bold text-[#0F172A] text-[13px]">{section.label}</span>
                                {section.required ? (
                                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">Required</span>
                                ) : (
                                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#94A3B8] bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 rounded-full">Optional</span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#94A3B8] mt-0.5 leading-relaxed">{section.description}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => pickFile(section.type)}
                              className={cn(
                                'shrink-0 text-xs font-bold rounded-xl px-3 py-1.5 border transition whitespace-nowrap',
                                hasFiles
                                  ? 'text-[#334155] bg-[#F8FAFC] border-[#E2E8F0] hover:bg-[#F1F5F9]'
                                  : section.required
                                  ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                                  : 'text-[#64748B] bg-white border-[#E2E8F0] hover:bg-[#F8FAFC]'
                              )}
                            >
                              {hasFiles ? '+ Add more' : '+ Add PDF'}
                            </button>
                          </div>

                          {hasFiles && (
                            <div className="px-4 pb-3.5 ml-[46px] space-y-1.5">
                              {sectionFiles.map(entry => (
                                <div
                                  key={entry.id}
                                  onClick={() => openPreview(entry)}
                                  className={cn(
                                    'flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer transition group',
                                    previewEntry?.id === entry.id
                                      ? 'bg-blue-50 border-blue-200'
                                      : 'bg-[#F8FAFC] border-[#E2E8F0] hover:bg-blue-50 hover:border-blue-200'
                                  )}
                                >
                                  <span className="text-[11px] text-[#94A3B8] shrink-0">📄</span>
                                  <span className="flex-1 text-[12px] text-[#334155] font-medium truncate">{entry.file.name}</span>
                                  <span className="text-[10px] text-[#94A3B8] shrink-0 group-hover:text-blue-400 transition">
                                    {previewEntry?.id === entry.id ? 'previewing' : 'preview'}
                                  </span>
                                  <span className="text-[10px] text-[#CBD5E1] shrink-0">{(entry.file.size / 1024 / 1024).toFixed(1)} MB</span>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); removeEntry(entry.id) }}
                                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full text-[#CBD5E1] hover:text-red-400 hover:bg-red-50 transition text-[10px]"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {error && <p className="text-red-600 text-sm">{error}</p>}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setStep('details')}
                      className="flex-1 rounded-xl px-4 py-3 text-sm font-bold bg-white border border-[#E2E8F0] text-[#64748B] hover:bg-[#F8FAFC] transition shadow-sm"
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={!hasLectureFile}
                      className="flex-[2] rounded-xl px-4 py-3 text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
                    >
                      Build study path →
                    </button>
                  </div>
                </div>

                {/* ── RIGHT: preview pane (sticky) ── */}
                <div className="h-full" style={{ minHeight: '420px' }}>
                  <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden flex flex-col h-full">
                    {previewEntry && previewUrl ? (
                      <>
                        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#F1F5F9] shrink-0">
                          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                            <span className="text-xs">📄</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-[#0F172A] truncate leading-tight">{previewEntry.file.name}</p>
                            <p className="text-[10px] text-[#94A3B8] mt-0.5">
                              {(previewEntry.file.size / 1024 / 1024).toFixed(1)} MB · {MATERIAL_SECTIONS.find(s => s.type === previewEntry.materialType)?.label}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={closePreview}
                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-[#CBD5E1] hover:text-[#64748B] hover:bg-[#F1F5F9] transition text-xs font-bold"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="flex-1 overflow-hidden bg-[#F8FAFC]">
                          <iframe
                            src={previewUrl}
                            className="w-full h-full border-0"
                            title={previewEntry.file.name}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-center px-8">
                        <div className="w-16 h-16 rounded-2xl bg-[#F1F5F9] flex items-center justify-center mb-4">
                          <span className="text-3xl opacity-40">📄</span>
                        </div>
                        <p className="text-sm font-bold text-[#334155] mb-1.5">PDF preview</p>
                        <p className="text-xs text-[#94A3B8] leading-relaxed">Upload a file, then click it to<br />preview its contents here</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </form>
          )}

          {/* ── Processing / done ── */}
          {(step === 'processing' || step === 'done') && (
            <div className="mt-8 rounded-2xl border border-[#E2E8F0] bg-white px-7 py-7 shadow-sm space-y-3">
              <p className="text-[#0F172A] font-bold text-[15px] mb-5">
                {step === 'done' ? '✅ Done! Redirecting…' : 'Building your study path…'}
              </p>
              {statuses.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {s.done ? (
                    <span className="text-green-500 w-5 text-center shrink-0">✓</span>
                  ) : i === statuses.length - 1 ? (
                    <Spinner className="text-blue-500 w-4 h-4 shrink-0" />
                  ) : (
                    <span className="text-[#CBD5E1] w-5 text-center shrink-0">·</span>
                  )}
                  <span className={s.done ? 'text-[#94A3B8]' : 'text-[#0F172A]'}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
