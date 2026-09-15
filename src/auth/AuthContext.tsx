import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { SessionUser } from '../types'
import { login as loginRequest } from '../services/salesStore'

const SESSION_KEY = 'esp.v4.user'

type AuthContextValue = {
  user: SessionUser | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  })

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      login: async (username, password) => {
        const found = await loginRequest(username, password)
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(found))
        setUser(found)
      },
      logout: () => {
        sessionStorage.removeItem(SESSION_KEY)
        setUser(null)
      },
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
