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
    case 'green': return 'text-green-600'
    case 'yellow': return 'text-yellow-600'
    case 'red': return 'text-red-600'
    default: return 'text-slate-400'
  }
}

export function masteryBg(level: string): string {
  switch (level) {
    case 'green': return 'bg-green-50 border-green-200'
    case 'yellow': return 'bg-yellow-50 border-yellow-200'
    case 'red': return 'bg-red-50 border-red-200'
    default: return 'bg-slate-50 border-slate-200'
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
