import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '../_app'
import { cn } from '@/lib/utils'

export default function LoginPage() {
  const router = useRouter()
  const { session, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && session) {
      router.replace('/')
    }
  }, [session, loading, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  if (loading) return null

  return (
    <>
      <Head>
        <title>fuckexam — log in</title>
      </Head>
      <div className="min-h-screen flex items-center justify-center px-4 bg-zinc-950">
        <div className="w-full max-w-sm">
          <div className="mb-10 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">fuckexam</h1>
            <p className="text-zinc-400 text-sm">your personal exam readiness coach</p>
          </div>

          {sent ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
              <div className="text-3xl mb-3">📬</div>
              <p className="text-white font-medium mb-1">Check your email</p>
              <p className="text-zinc-400 text-sm">
                We sent a magic link to <span className="text-white">{email}</span>.
                Click it to sign in — no password needed.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@student.unimelb.edu.au"
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !email}
                className={cn(
                  'w-full rounded-lg px-4 py-2.5 text-sm font-medium transition',
                  'bg-indigo-600 text-white hover:bg-indigo-500',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {submitting ? 'Sending…' : 'Send magic link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
