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
      <div className="rounded-2xl border border-green-200 bg-green-50 p-5 flex items-center gap-4">
        <span className="text-2xl">🏆</span>
        <div>
          <p className="text-green-700 font-bold text-sm">{task.reason}</p>
          <p className="text-[#64748B] text-xs mt-0.5">All stages complete</p>
        </div>
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

  const isRepair = task.type === 'repair_drill' || task.type === 'review_drill'

  return (
    <div className={cn(
      'rounded-2xl border p-5',
      isRepair
        ? 'border-amber-200 bg-amber-50'
        : 'border-blue-200 bg-blue-50'
    )}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className={cn(
            'text-[11px] font-bold uppercase tracking-[0.1em] mb-1.5',
            isRepair ? 'text-amber-600' : 'text-blue-600'
          )}>
            {isRepair ? '⚠ Repair needed' : '▶ Recommended next'}
          </p>
          <p className="text-[#0F172A] font-bold text-sm leading-snug">{task.reason}</p>
          {task.estimated_minutes && (
            <p className="text-[#64748B] text-xs mt-1">~{task.estimated_minutes} min</p>
          )}
        </div>
        <button
          onClick={handleStart}
          className={cn(
            'shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition whitespace-nowrap active:scale-95',
            isRepair
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          )}
        >
          {isRepair ? 'Fix it →' : 'Start →'}
        </button>
      </div>
    </div>
  )
}
