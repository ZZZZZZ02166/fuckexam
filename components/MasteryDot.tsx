import { cn } from '@/lib/utils'
import type { MasteryLevel } from '@/types/database'

const config: Record<MasteryLevel, { bg: string; label: string; chipBg: string; chipText: string }> = {
  green:  { bg: 'bg-green-600',  label: 'Mastered',     chipBg: 'bg-[#DCFCE7] border border-[#BBF7D0]', chipText: 'text-green-700' },
  yellow: { bg: 'bg-amber-500',  label: 'Shaky',        chipBg: 'bg-[#FEF3C7] border border-[#FDE68A]', chipText: 'text-amber-700' },
  red:    { bg: 'bg-red-500',    label: 'Weak',         chipBg: 'bg-[#FEE2E2] border border-[#FECACA]', chipText: 'text-red-700' },
  grey:   { bg: 'bg-slate-400',  label: 'Not started',  chipBg: 'bg-[#F1F5F9] border border-[#E2E8F0]', chipText: 'text-slate-500' },
}

export function MasteryDot({ level, size = 'sm' }: { level: MasteryLevel; size?: 'sm' | 'md' }) {
  const { bg } = config[level] ?? config.grey
  const dim = size === 'sm' ? 'w-[9px] h-[9px]' : 'w-[11px] h-[11px]'
  return (
    <span
      className={cn('inline-block rotate-45 rounded-[2px] shrink-0', bg, dim)}
    />
  )
}

export function MasteryChip({ level }: { level: MasteryLevel }) {
  const { chipBg, chipText, label } = config[level] ?? config.grey
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0', chipBg, chipText)}>
      {label}
    </span>
  )
}
