import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useAuth } from '@/pages/_app'
import { apiJson } from '@/lib/apiFetch'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Subject } from '@/types/database'

interface LayoutProps {
  children: React.ReactNode
  backHref?: string
  backLabel?: string
  title?: string
  actions?: React.ReactNode
}

export function Layout({ children, backHref, backLabel, title, actions }: LayoutProps) {
  const router = useRouter()
  const { user } = useAuth()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { id: currentSubjectId } = router.query as { id?: string }

  useEffect(() => {
    apiJson<Subject[]>('/api/subjects').then(setSubjects).catch(() => {})
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isDashboard = router.pathname === '/'
  const isPathPage = router.pathname.includes('/path') || router.pathname.includes('/stages')
  const isMastery = router.pathname.includes('/mastery')

  const navItems = [
    {
      href: '/',
      label: 'Dashboard',
      icon: '🏠',
      active: isDashboard,
    },
    {
      href: currentSubjectId ? `/subjects/${currentSubjectId}/path` : '/',
      label: 'Study Path',
      icon: '📚',
      active: isPathPage && !isMastery,
    },
    {
      href: currentSubjectId ? `/subjects/${currentSubjectId}/mastery` : '/',
      label: 'Mastery Map',
      icon: '💎',
      active: isMastery,
    },
  ]

  const displayName = user?.email?.split('@')[0] ?? 'Student'

  function SidebarContent() {
    return (
      <>
        <div className="px-5 py-5 border-b border-white/10">
          <div className="text-white font-extrabold text-lg tracking-tight">fuckexam</div>
          <div className="text-[#93C5FD] text-xs font-medium mt-0.5">AI study companion</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#93C5FD] px-2.5 py-1 mb-1">Menu</p>
          <div className="space-y-0.5">
            {navItems.map(item => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-semibold transition-all',
                  item.active
                    ? 'bg-white/15 text-white'
                    : 'text-[#93C5FD] hover:bg-white/10 hover:text-white'
                )}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>

          {subjects.length > 0 && (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#93C5FD] px-2.5 py-1 mt-5 mb-1">Subjects</p>
              <div className="space-y-0.5">
                {subjects.map(s => (
                  <Link
                    key={s.id}
                    href={`/subjects/${s.id}/path`}
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium transition-all',
                      currentSubjectId === s.id
                        ? 'bg-white/15 text-white'
                        : 'text-[#93C5FD] hover:bg-white/10 hover:text-white'
                    )}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#93C5FD] shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </Link>
                ))}
              </div>
            </>
          )}

          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#93C5FD] px-2.5 py-1 mt-5 mb-1">Account</p>
          <Link
            href="/subjects/new"
            onClick={() => setDrawerOpen(false)}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-semibold text-[#93C5FD] hover:bg-white/10 hover:text-white transition-all"
          >
            <span className="text-base w-5 text-center">＋</span>
            Add subject
          </Link>
        </nav>

        <div className="px-3 py-4 border-t border-white/10">
          <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl bg-white/6">
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center text-sm shrink-0">🎓</div>
            <div className="min-w-0 flex-1">
              <p className="text-white font-bold text-[13px] truncate">{displayName}</p>
              <button
                onClick={handleSignOut}
                className="text-[#93C5FD] text-xs hover:text-white transition text-left"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#F0F4FF]">
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex w-60 shrink-0 fixed top-0 left-0 h-screen flex-col z-50"
        style={{ background: '#1E3A8A' }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile sidebar drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="absolute top-0 left-0 h-full w-64 flex flex-col shadow-2xl"
            style={{ background: '#1E3A8A' }}
          >
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
              <span className="text-white font-extrabold text-lg">fuckexam</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-[#93C5FD] hover:text-white text-xl leading-none transition"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              <SidebarContent />
            </div>
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col lg:ml-60 min-h-screen">
        {/* Topbar */}
        <header className="h-14 bg-white border-b border-[#E2E8F0] sticky top-0 z-40 flex items-center px-4 lg:px-8 gap-3">
          {/* Mobile: logo / back + hamburger */}
          <div className="flex items-center gap-2 lg:hidden min-w-0">
            {backHref ? (
              <Link
                href={backHref}
                className="text-[#64748B] hover:text-[#0F172A] text-sm font-semibold transition px-2 py-1.5 rounded-lg hover:bg-[#F0F4FF] flex items-center gap-1"
              >
                ← {backLabel}
              </Link>
            ) : (
              <span className="font-extrabold text-[#1E3A8A] text-base">fuckexam</span>
            )}
          </div>

          {/* Desktop: back + crumb */}
          <div className="hidden lg:flex items-center gap-1">
            {backHref && (
              <Link
                href={backHref}
                className="flex items-center gap-1 text-sm font-semibold text-[#64748B] hover:text-[#0F172A] hover:bg-[#F0F4FF] px-3 py-1.5 rounded-xl transition"
              >
                ← {backLabel}
              </Link>
            )}
            {title && backHref && <span className="text-[#CBD5E1]">/</span>}
            {title && <span className="font-bold text-[#1E293B] text-sm">{title}</span>}
            {title && !backHref && <span className="font-bold text-[#1E293B] text-sm">{title}</span>}
          </div>

          <div className="flex-1" />

          {actions && (
            <div className="flex items-center gap-2">{actions}</div>
          )}

          <button
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden p-2 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F0F4FF] transition"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="max-w-[1080px] mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
