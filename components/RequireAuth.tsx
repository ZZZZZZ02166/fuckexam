import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '@/pages/_app'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/auth/login')
    }
  }, [session, loading, router])

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
