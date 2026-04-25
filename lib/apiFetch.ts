import { supabase } from '@/lib/supabase/client'

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
}

export async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(url, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? res.statusText)
  }
  return res.json()
}
