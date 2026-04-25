import { useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { RequireAuth } from '@/components/RequireAuth'
import { Spinner } from '@/components/Spinner'
import { supabase } from '@/lib/supabase/client'
import { apiJson } from '@/lib/apiFetch'
import { useAuth } from '../_app'
import { cn } from '@/lib/utils'

type Step = 'details' | 'upload' | 'processing' | 'done'

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

  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [examFormat, setExamFormat] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<ProcessingStatus[]>([])

  function updateStatus(label: string) {
    setStatuses(prev => [...prev, { label, done: false }])
  }
  function completeStatus() {
    setStatuses(prev => {
      const next = [...prev]
      if (next.length) next[next.length - 1] = { ...next[next.length - 1], done: true }
      return next
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setStep('upload')
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !user) return
    setError('')
    setStep('processing')
    setStatuses([])

    try {
      // 1. Create subject
      updateStatus('Creating subject…')
      const subject = await apiJson<{ id: string }>('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ name, exam_date: examDate || undefined, exam_format_text: examFormat || undefined }),
      })
      completeStatus()

      // 2. Upload file to Supabase Storage
      updateStatus('Uploading file…')
      const storagePath = `${user.id}/${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from('materials')
        .upload(storagePath, file, { contentType: file.type })
      if (uploadErr) throw new Error(uploadErr.message)
      completeStatus()

      // 3. Process material (parse + embed + extract topics)
      updateStatus('Extracting topics from your materials…')
      await apiJson('/api/process-material', {
        method: 'POST',
        body: JSON.stringify({ subject_id: subject.id, storage_path: storagePath, file_name: file.name }),
      })
      completeStatus()

      // 4. Generate study path
      updateStatus('Building your study path…')
      await apiJson('/api/generate-path', {
        method: 'POST',
        body: JSON.stringify({ subject_id: subject.id }),
      })
      completeStatus()

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
      <div className="min-h-screen bg-zinc-950 px-4 py-12">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => router.push('/')}
            className="text-zinc-400 hover:text-white text-sm mb-8 flex items-center gap-1 transition"
          >
            ← Dashboard
          </button>

          <h1 className="text-2xl font-bold text-white mb-1">New subject</h1>
          <p className="text-zinc-400 text-sm mb-8">
            Upload your course materials and we'll build a personalised study path.
          </p>

          {step === 'details' && (
            <form onSubmit={handleCreate} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Subject name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Computer Networks"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Exam date <span className="text-zinc-500">(optional)</span></label>
                <input
                  type="date"
                  value={examDate}
                  onChange={e => setExamDate(e.target.value)}
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Describe your exam format
                  <span className="text-zinc-500 font-normal ml-1">(optional but recommended)</span>
                </label>
                <textarea
                  rows={3}
                  value={examFormat}
                  onChange={e => setExamFormat(e.target.value)}
                  placeholder="e.g. 2-hour written exam, closed-book, 30% MCQ + 50% short answer + 20% problem-solving calculations"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={!name.trim()}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Next: upload materials →
              </button>
            </form>
          )}

          {step === 'upload' && (
            <form onSubmit={handleUpload} className="space-y-5">
              <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400">
                <p className="text-white font-medium">{name}</p>
                {examDate && <p>Exam: {new Date(examDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
                {examFormat && <p className="mt-1 text-xs">{examFormat}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">Upload course material</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    'cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition',
                    file ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-700 hover:border-zinc-500'
                  )}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={e => setFile(e.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <div>
                      <p className="text-indigo-400 font-medium text-sm">📄 {file.name}</p>
                      <p className="text-zinc-500 text-xs mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-zinc-400 text-sm">Click to upload a PDF</p>
                      <p className="text-zinc-600 text-xs mt-1">Lecture slides, notes, or tutorial sheets</p>
                    </div>
                  )}
                </div>
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('details')}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={!file}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Build study path →
                </button>
              </div>
            </form>
          )}

          {(step === 'processing' || step === 'done') && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-3">
              <p className="text-white font-medium mb-4">
                {step === 'done' ? '✅ Done! Redirecting…' : 'Building your study path…'}
              </p>
              {statuses.map((s, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {s.done ? (
                    <span className="text-green-400 w-4">✓</span>
                  ) : i === statuses.length - 1 ? (
                    <Spinner className="text-indigo-400 w-4 h-4" />
                  ) : (
                    <span className="text-zinc-600 w-4">·</span>
                  )}
                  <span className={s.done ? 'text-zinc-400' : 'text-white'}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
