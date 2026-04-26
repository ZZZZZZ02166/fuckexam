import { useRouter } from 'next/router'
import type { NextBestTask } from '@/types/database'
import { cn } from '@/lib/utils'

interface Props {
  task: NextBestTask
  subjectId: string
}

export function NextBestTaskCard({ task, subjectId }: Props) {
  const router = useRouter()

  if (task.type === 'complete') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4">
        <p className="text-green-700 font-medium text-sm">🎉 {task.reason}</p>
      </div>
    )
  }

  function handleStart() {
    if (task.stage_id) {
      if (task.type === 'start_stage' || task.type === 'continue_stage') {
        router.push(`/subjects/${subjectId}/stages/${task.stage_id}`)
      } else {
        router.push(`/subjects/${subjectId}/stages/${task.stage_id}?repair=${task.topic_id ?? ''}`)
      }
    }
  }

  const icon = task.type === 'repair_drill' ? '⚠️' :
               task.type === 'review_drill' ? '🔄' : '▶'

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-0.5">Next</p>
        <p className="text-slate-900 font-medium text-sm leading-snug">
          {icon} {task.reason}
        </p>
        {task.estimated_minutes && (
          <p className="text-slate-500 text-xs mt-0.5">~{task.estimated_minutes} min</p>
        )}
      </div>
      <button
        onClick={handleStart}
        className={cn(
          'shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition',
          'bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap'
        )}
      >
        Start →
      </button>
    </div>
  )
}
