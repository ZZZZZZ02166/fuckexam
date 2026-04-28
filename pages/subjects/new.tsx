import { useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { RequireAuth } from '@/components/RequireAuth'
import { Spinner } from '@/components/Spinner'
import { supabase } from '@/lib/supabase/client'
import { apiJson } from '@/lib/apiFetch'
import { useAuth } from '../_app'
import { cn } from '@/lib/utils'
import type { UploadMaterialType } from '@/types/database'
import { UPLOAD_MATERIAL_TYPE_LABELS } from '@/types/database'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingTypeRef = useRef<UploadMaterialType>('course_lecture_material')

  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [examFormat, setExamFormat] = useState('')
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([])
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<ProcessingStatus[]>([])

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

  function openFilePicker(materialType: UploadMaterialType) {
    pendingTypeRef.current = materialType
    fileRef.current?.click()
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (!picked) return
    setFileEntries(prev => [
      ...prev,
      { id: `${Date.now()}_${Math.random()}`, file: picked, materialType: pendingTypeRef.current },
    ])
    e.target.value = ''
  }

  function removeEntry(id: string) {
    setFileEntries(prev => prev.filter(e => e.id !== id))
  }

  function updateType(id: string, materialType: UploadMaterialType) {
    setFileEntries(prev => prev.map(e => e.id === id ? { ...e, materialType } : e))
  }

  const hasLectureFile = fileEntries.some(e => e.materialType === 'course_lecture_material')

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

    try {
      addStatus('Creating subject…')
      const subject = await apiJson<{ id: string }>('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ name, exam_date: examDate || undefined, exam_format_text: examFormat || undefined }),
      })
      completeStatus()

      // Process lecture material files first so topic/stage extraction runs before other types
      const ordered = [...fileEntries].sort((a, b) =>
        a.materialType === 'course_lecture_material' ? -1 : b.materialType === 'course_lecture_material' ? 1 : 0
      )

      for (const entry of ordered) {
        addStatus(`Uploading ${entry.file.name}…`)
        const storagePath = `${user.id}/${Date.now()}_${entry.file.name}`
        const { error: uploadErr } = await supabase.storage
          .from('materials')
          .upload(storagePath, entry.file, { contentType: entry.file.type })
        if (uploadErr) throw new Error(uploadErr.message)
        completeStatus()

        const isLecture = entry.materialType === 'course_lecture_material'
        addStatus(isLecture ? 'Analysing material and building your study path…' : `Processing ${entry.file.name}…`)
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
      }

      setStep('done')
      setTimeout(() => router.push(`/subjects/${subject.id}/path`), 800)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
      setStep('upload')
    }
  }

  return (
    <>
      <Head><title>New subject — fuckexam</title></Head>
      <div className="min-h-screen bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-4 py-3">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => router.push('/')}
              className="text-slate-400 hover:text-slate-700 text-sm flex items-center gap-1 transition"
            >
              ← Dashboard
            </button>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">New subject</h1>
          <p className="text-slate-500 text-sm mb-8">
            Upload your course materials and we'll build a personalised study path.
          </p>

          {step === 'details' && (
            <form onSubmit={handleCreate} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Subject name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Computer Networks"
                  className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Exam date <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={examDate}
                  onChange={e => setExamDate(e.target.value)}
                  className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Describe your exam format
                  <span className="text-slate-400 font-normal ml-1">(optional but recommended)</span>
                </label>
                <textarea
                  rows={3}
                  value={examFormat}
                  onChange={e => setExamFormat(e.target.value)}
                  placeholder="e.g. 2-hour written exam, closed-book, 30% MCQ + 50% short answer + 20% problem-solving calculations"
                  className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={!name.trim()}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Next: upload materials →
              </button>
            </form>
          )}

          {step === 'upload' && (
            <form onSubmit={handleUpload} className="space-y-5">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
                <p className="text-slate-900 font-medium">{name}</p>
                {examDate && <p>Exam: {new Date(examDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
                {examFormat && <p className="mt-1 text-xs">{examFormat}</p>}
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={onFileSelected}
              />

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Upload your materials</label>

                {fileEntries.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {fileEntries.map(entry => (
                      <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                        <span className="text-slate-400 text-sm shrink-0">📄</span>
                        <span className="text-sm text-slate-700 flex-1 truncate">{entry.file.name}</span>
                        <select
                          value={entry.materialType}
                          onChange={e => updateType(entry.id, e.target.value as UploadMaterialType)}
                          className="text-xs rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400 shrink-0"
                        >
                          {(Object.entries(UPLOAD_MATERIAL_TYPE_LABELS) as [UploadMaterialType, string][]).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.id)}
                          className="text-slate-300 hover:text-red-400 transition text-sm ml-1 shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => openFilePicker('course_lecture_material')}
                  className="w-full rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition text-center"
                >
                  + Add a PDF file
                </button>

                {fileEntries.length > 0 && !hasLectureFile && (
                  <p className="mt-2 text-xs text-amber-600">
                    At least one file must be labelled as "Course lecture material" to build your study path.
                  </p>
                )}
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('details')}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={!hasLectureFile}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Build study path →
                </button>
              </div>
            </form>
          )}

          {(step === 'processing' || step === 'done') && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3 shadow-sm">
              <p className="text-slate-900 font-medium mb-4">
                {step === 'done' ? '✅ Done! Redirecting…' : 'Building your study path…'}
              </p>
              {statuses.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {s.done ? (
                    <span className="text-green-600 w-4">✓</span>
                  ) : i === statuses.length - 1 ? (
                    <Spinner className="text-blue-500 w-4 h-4" />
                  ) : (
                    <span className="text-slate-300 w-4">·</span>
                  )}
                  <span className={s.done ? 'text-slate-400' : 'text-slate-900'}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
