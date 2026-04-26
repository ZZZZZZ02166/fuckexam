import { cn } from '@/lib/utils'

interface Props {
  score: number
  size?: 'sm' | 'lg'
  showLabel?: boolean
}

export function ReadinessBar({ score, size = 'sm', showLabel = true }: Props) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-400' : 'bg-red-500'

  if (size === 'lg') {
    return (
      <div className="space-y-2">
        <div className="flex items-end gap-3">
          <span className="text-5xl font-bold text-slate-900 tabular-nums">{score}%</span>
          <span className="text-slate-500 text-sm pb-1">exam ready</span>
        </div>
        <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-700', color)}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Readiness</span>
          <span className="text-slate-900 font-medium tabular-nums">{score}%</span>
        </div>
      )}
      <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  )
}
