import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionUser } from '../types'
import { getSession, login as loginRequest, logoutSession } from '../services/salesStore'
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from './session'

type AuthContextValue = {
  user: SessionUser | null
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredUser(): SessionUser | null {
  const raw = sessionStorage.getItem(SESSION_USER_KEY)
  return raw ? (JSON.parse(raw) as SessionUser) : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(readStoredUser)
  const [ready, setReady] = useState(() => !sessionStorage.getItem(SESSION_TOKEN_KEY))

  function persist(next: SessionUser | null, token?: string) {
    if (!next) {
      sessionStorage.removeItem(SESSION_USER_KEY)
      sessionStorage.removeItem(SESSION_TOKEN_KEY)
      setUser(null)
      return
    }
    if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(next))
    setUser(next)
  }

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY)
    if (!token) {
      setReady(true)
      return
    }
    getSession()
      .then((next) => persist(next))
      .catch(() => persist(null))
      .finally(() => setReady(true))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      login: async (username, password) => {
        const found = await loginRequest(username, password)
        const { token, ...next } = found
        persist(next, token)
      },
      logout: () => {
        void logoutSession().catch(() => undefined)
        persist(null)
      },
    }),
    [user, ready],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
