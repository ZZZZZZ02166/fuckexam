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
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && session) {
      router.replace('/')
    }
  }, [session, loading, router])

  async function handleMagicLink(e: React.FormEvent) {
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

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    })
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
    // on success the browser redirects — no state cleanup needed
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
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
              {/* Google */}
              <button
                onClick={handleGoogle}
                disabled={googleLoading}
                className={cn(
                  'w-full flex items-center justify-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition',
                  'bg-white text-zinc-900 hover:bg-zinc-100',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <GoogleIcon />
                {googleLoading ? 'Redirecting…' : 'Continue with Google'}
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-zinc-600 text-xs">or</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>

              {/* Magic link */}
              <form onSubmit={handleMagicLink} className="space-y-3">
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
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58Z"/>
    </svg>
  )
}
