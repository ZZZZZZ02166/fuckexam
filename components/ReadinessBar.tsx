import { cn } from '@/lib/utils'

interface Props {
  score: number
  size?: 'sm' | 'lg'
  showLabel?: boolean
}

export function ReadinessBar({ score, size = 'sm', showLabel = true }: Props) {
  const fillClass = score >= 70
    ? 'bg-green-600'
    : score >= 40
    ? 'bg-amber-500'
    : 'bg-red-500'

  if (size === 'lg') {
    return (
      <div className="space-y-3">
        <div className="flex items-end gap-3">
          <span className="text-5xl font-extrabold text-[#0F172A] tabular-nums leading-none">{score}%</span>
          <span className="text-[#64748B] text-sm pb-1">exam ready</span>
        </div>
        <div className="h-3 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-700', fillClass)}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#64748B] font-medium">Readiness</span>
          <span className="text-[#0F172A] font-bold tabular-nums">{score}%</span>
        </div>
      )}
      <div className="h-2 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', fillClass)}
          style={{ width: `${Math.max(score, score > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  )
}
