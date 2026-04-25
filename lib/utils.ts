import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function daysUntil(date: string | Date | null): number | null {
  if (!date) return null
  const diff = new Date(date).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function masteryColor(level: string): string {
  switch (level) {
    case 'green': return 'text-green-400'
    case 'yellow': return 'text-yellow-400'
    case 'red': return 'text-red-400'
    default: return 'text-zinc-500'
  }
}

export function masteryBg(level: string): string {
  switch (level) {
    case 'green': return 'bg-green-500/20 border-green-500/40'
    case 'yellow': return 'bg-yellow-500/20 border-yellow-500/40'
    case 'red': return 'bg-red-500/20 border-red-500/40'
    default: return 'bg-zinc-800 border-zinc-700'
  }
}

export function masteryLabel(level: string): string {
  switch (level) {
    case 'green': return 'Solid'
    case 'yellow': return 'Shaky'
    case 'red': return 'Weak'
    default: return 'Not started'
  }
}
