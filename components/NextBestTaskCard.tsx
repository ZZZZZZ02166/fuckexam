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
      <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
        <p className="text-green-400 font-medium text-sm">🎉 {task.reason}</p>
      </div>
    )
  }

  function handleStart() {
    if (task.stage_id) {
      if (task.type === 'start_stage' || task.type === 'continue_stage') {
        router.push(`/subjects/${subjectId}/stages/${task.stage_id}`)
      } else {
        // repair or review — go to the stage
        router.push(`/subjects/${subjectId}/stages/${task.stage_id}?repair=${task.topic_id ?? ''}`)
      }
    }
  }

  const icon = task.type === 'repair_drill' ? '⚠️' :
               task.type === 'review_drill' ? '🔄' : '▶'

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-indigo-400 uppercase tracking-wide mb-0.5">Next</p>
        <p className="text-white font-medium text-sm leading-snug">
          {icon} {task.reason}
        </p>
        {task.estimated_minutes && (
          <p className="text-zinc-400 text-xs mt-0.5">~{task.estimated_minutes} min</p>
        )}
      </div>
      <button
        onClick={handleStart}
        className={cn(
          'shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition',
          'bg-indigo-600 text-white hover:bg-indigo-500 whitespace-nowrap'
        )}
      >
        Start →
      </button>
    </div>
  )
}
