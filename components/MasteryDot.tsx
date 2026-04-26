import { cn } from '@/lib/utils'
import type { MasteryLevel } from '@/types/database'

const config: Record<MasteryLevel, { bg: string; label: string }> = {
  green:  { bg: 'bg-green-500',  label: 'Solid' },
  yellow: { bg: 'bg-yellow-400', label: 'Shaky' },
  red:    { bg: 'bg-red-500',    label: 'Weak' },
  grey:   { bg: 'bg-slate-400',  label: 'Not started' },
}

export function MasteryDot({ level, size = 'sm' }: { level: MasteryLevel; size?: 'sm' | 'md' }) {
  const { bg } = config[level] ?? config.grey
  return (
    <span
      className={cn(
        'inline-block rounded-full',
        bg,
        size === 'sm' ? 'w-2 h-2' : 'w-3 h-3'
      )}
    />
  )
}

export function MasteryChip({ level }: { level: MasteryLevel }) {
  const { bg, label } = config[level] ?? config.grey
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-white', bg)}>
      {label}
    </span>
  )
}
