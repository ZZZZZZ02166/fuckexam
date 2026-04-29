import { useEffect, useRef, useState } from 'react'
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
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/pages/_app'
import { computeNextBestTask, computeReadinessScore } from '@/lib/nextBestTask'
import { daysUntil, cn } from '@/lib/utils'
import type { Subject, StudyStage, Topic, MasteryRecord, NextBestTask, UploadMaterialType } from '@/types/database'
import { UPLOAD_MATERIAL_TYPE_LABELS } from '@/types/database'

interface MaterialRow {
  id: string
  file_name: string
  material_type: string | null
  created_at: string | null
  processed_at: string | null
}

interface SubjectData {
  subject: Subject
  topics: Topic[]
  stages: StudyStage[]
  mastery: MasteryRecord[]
  readiness_history: { score: number; computed_at: string }[]
  materials: MaterialRow[]
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
  const { user } = useAuth()
  const [data, setData] = useState<SubjectData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function reload() {
    if (!id) return
    apiJson<SubjectData>(`/api/subjects/${id}`).then(setData).catch(() => {})
  }

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

  const { subject, topics, stages, mastery, readiness_history, materials } = data
  const score = computeReadinessScore(stages, topics, mastery)
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
              {stages.map((s, i) => {
                const ml = stageMasteryLevel(s)
                return (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 flex-1 rounded-full transition-all',
                      s.status === 'in_progress' ? 'bg-blue-500' :
                      s.status === 'complete' && ml === 'green'  ? 'bg-green-500' :
                      s.status === 'complete' && ml === 'yellow' ? 'bg-amber-400' :
                      s.status === 'complete' && ml === 'red'    ? 'bg-red-400' :
                      s.status === 'complete'                    ? 'bg-amber-400' :
                      'bg-[#E2E8F0]'
                    )}
                  />
                )
              })}
            </div>
          </div>

          {/* Next best task */}
          <NextBestTaskCard task={nextTask} subjectId={id} />

          {/* Materials */}
          <MaterialsSection materials={materials ?? []} subjectId={id} userId={user?.id} onUploaded={reload} />

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
                          isActive
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : isComplete && ml === 'green'
                            ? 'bg-green-50 border-green-400 text-green-700'
                            : isComplete && ml === 'yellow'
                            ? 'bg-amber-50 border-amber-400 text-amber-700'
                            : isComplete && ml === 'red'
                            ? 'bg-red-50 border-red-400 text-red-700'
                            : isComplete
                            ? 'bg-amber-50 border-amber-400 text-amber-700'
                            : 'bg-white border-[#CBD5E1] text-[#94A3B8]'
                        )}
                      >
                        {isComplete ? '✓' : stage.stage_order}
                      </button>
                      {index < stages.length - 1 && (
                        <div className={cn(
                          'w-0.5 flex-1 my-1.5 rounded-full min-h-[16px]',
                          isComplete && ml === 'green'  ? 'bg-green-300' :
                          isComplete && ml === 'yellow' ? 'bg-amber-200' :
                          isComplete && ml === 'red'    ? 'bg-red-200' :
                          isComplete                    ? 'bg-amber-200' :
                          'bg-[#E2E8F0]'
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
                          : isComplete && ml === 'green'
                          ? 'border-green-200 bg-green-50 hover:border-green-300'
                          : isComplete && ml === 'yellow'
                          ? 'border-amber-200 bg-amber-50 hover:border-amber-300'
                          : isComplete && ml === 'red'
                          ? 'border-red-200 bg-red-50 hover:border-red-300'
                          : isComplete
                          ? 'border-[#E2E8F0] bg-white hover:border-green-200'
                          : 'border-[#E2E8F0] bg-white hover:border-blue-200 hover:shadow-sm'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={cn(
                            'font-bold text-sm truncate',
                            isActive ? 'text-[#0F172A]' :
                            isComplete && ml === 'green' ? 'text-green-800' :
                            isComplete && ml === 'yellow' ? 'text-amber-800' :
                            isComplete && ml === 'red' ? 'text-red-800' :
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

function MaterialsSection({
  materials,
  subjectId,
  userId,
  onUploaded,
}: {
  materials: MaterialRow[]
  subjectId: string
  userId?: string
  onUploaded: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedType, setSelectedType] = useState<UploadMaterialType>('course_lecture_material')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [pendingRebuild, setPendingRebuild] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildError, setRebuildError] = useState('')

  const grouped = Object.entries(UPLOAD_MATERIAL_TYPE_LABELS).map(([type, label]) => ({
    type: type as UploadMaterialType,
    label,
    files: materials.filter(m => (m.material_type ?? 'course_lecture_material') === type),
  })).filter(g => g.files.length > 0)

  async function handleUpload() {
    if (!selectedFile || !userId) return
    setUploading(true)
    setUploadError('')
    try {
      const storagePath = `${userId}/${Date.now()}_${selectedFile.name}`
      const { error: uploadErr } = await supabase.storage
        .from('materials')
        .upload(storagePath, selectedFile, { contentType: selectedFile.type })
      if (uploadErr) throw new Error(uploadErr.message)
      await apiJson('/api/process-material', {
        method: 'POST',
        body: JSON.stringify({
          subject_id: subjectId,
          storage_path: storagePath,
          file_name: selectedFile.name,
          material_type: selectedType,
        }),
      })
      setSelectedFile(null)
      setShowAdd(false)
      if (selectedType === 'course_lecture_material') {
        setPendingRebuild(true)
      }
      onUploaded()
    } catch (err: any) {
      setUploadError(err.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleRebuild() {
    setRebuilding(true)
    setRebuildError('')
    try {
      await apiJson(`/api/subjects/${subjectId}/build-path`, { method: 'POST' })
      setPendingRebuild(false)
      onUploaded()
    } catch (err: any) {
      setRebuildError(err.message ?? 'Rebuild failed')
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748B]">Materials</h2>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="text-xs font-bold text-blue-600 hover:text-blue-700 transition"
        >
          {showAdd ? 'Cancel' : '+ Add material'}
        </button>
      </div>

      {pendingRebuild && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 space-y-3 mb-3">
          <p className="text-sm font-bold text-amber-900">New lecture material added.</p>
          <p className="text-xs text-amber-700">Rebuild the study path so this file is included in the stages.</p>
          <p className="text-xs text-amber-600 italic">⚠ Rebuilding may replace your current study path. Some stage progress and mastery data may no longer match the new path.</p>
          {rebuildError && <p className="text-xs text-red-600">{rebuildError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              className="rounded-lg px-4 py-2 text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition flex items-center gap-2"
            >
              {rebuilding ? <><Spinner className="w-3 h-3" /> Rebuilding…</> : 'Rebuild study path'}
            </button>
            <button
              onClick={() => setPendingRebuild(false)}
              disabled={rebuilding}
              className="rounded-lg px-4 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100 transition"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#E2E8F0] px-5 py-4 space-y-4">
        {grouped.length === 0 && !showAdd && (
          <p className="text-sm text-slate-400">No materials uploaded yet.</p>
        )}

        {grouped.map(group => (
          <div key={group.type}>
            <p className="text-xs font-bold text-slate-500 mb-2">{group.label}</p>
            <div className="space-y-1.5">
              {group.files.map(f => (
                <div key={f.id} className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="text-slate-300">📄</span>
                  <span className="flex-1 truncate">{f.file_name}</span>
                  <span className="text-xs text-slate-300 shrink-0">
                    {f.created_at ? new Date(f.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {showAdd && (
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
            />

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">Material type</label>
              <select
                value={selectedType}
                onChange={e => setSelectedType(e.target.value as UploadMaterialType)}
                className="w-full text-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {(Object.entries(UPLOAD_MATERIAL_TYPE_LABELS) as [UploadMaterialType, string][]).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div>
              {selectedFile ? (
                <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                  <span className="text-sm text-blue-700 flex-1 truncate">📄 {selectedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="text-slate-300 hover:text-red-400 transition text-xs"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-lg border-2 border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400 hover:border-blue-300 hover:text-blue-500 transition"
                >
                  Click to select a PDF
                </button>
              )}
            </div>

            {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}

            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="w-full rounded-lg px-4 py-2 text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {uploading ? <><Spinner className="w-4 h-4" /> Processing…</> : 'Upload'}
            </button>
          </div>
        )}
      </div>
    </div>
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
