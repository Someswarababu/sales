import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionUser } from '../types'
import { getSession, login as loginRequest, logoutSession } from '../services/salesStore'
import {
  SESSION_ACTIVITY_KEY,
  SESSION_EXPIRED_EVENT,
  SESSION_IDLE_MS,
  SESSION_TOKEN_KEY,
  SESSION_USER_KEY,
} from './session'

type AuthContextValue = {
  user: SessionUser | null
  ready: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredUser(): SessionUser | null {
  const raw = sessionStorage.getItem(SESSION_USER_KEY)
  return raw ? (JSON.parse(raw) as SessionUser) : null
}

function readActivity() {
  const value = Number(sessionStorage.getItem(SESSION_ACTIVITY_KEY) || 0)
  return Number.isFinite(value) ? value : 0
}

function touchActivity() {
  sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(Date.now()))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(readStoredUser)
  const [ready, setReady] = useState(() => !sessionStorage.getItem(SESSION_TOKEN_KEY))

  function persist(next: SessionUser | null, token?: string) {
    if (!next) {
      sessionStorage.removeItem(SESSION_USER_KEY)
      sessionStorage.removeItem(SESSION_TOKEN_KEY)
      sessionStorage.removeItem(SESSION_ACTIVITY_KEY)
      setUser(null)
      return
    }
    if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(next))
    touchActivity()
    setUser(next)
  }

  useEffect(() => {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY)
    if (!token) {
      setReady(true)
      return
    }
    const last = readActivity()
    if (last && Date.now() - last > SESSION_IDLE_MS) {
      persist(null)
      setReady(true)
      return
    }
    getSession()
      .then((next) => persist(next))
      .catch(() => persist(null))
      .finally(() => setReady(true))
  }, [])

  useEffect(() => {
    function onExpired() {
      persist(null)
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  useEffect(() => {
    if (!user) return

    let timer = 0
    let lastTouch = 0

    function signOutIdle() {
      void logoutSession().catch(() => undefined)
      persist(null)
    }

    function schedule() {
      window.clearTimeout(timer)
      const last = readActivity() || Date.now()
      const remaining = SESSION_IDLE_MS - (Date.now() - last)
      if (remaining <= 0) {
        signOutIdle()
        return
      }
      timer = window.setTimeout(() => {
        if (Date.now() - (readActivity() || 0) >= SESSION_IDLE_MS) signOutIdle()
        else schedule()
      }, remaining)
    }

    function onActivity() {
      const now = Date.now()
      if (now - lastTouch < 1000) return
      lastTouch = now
      touchActivity()
      schedule()
    }

    if (!readActivity()) touchActivity()
    schedule()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true })
    }
    return () => {
      window.clearTimeout(timer)
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity)
      }
    }
  }, [user])

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
