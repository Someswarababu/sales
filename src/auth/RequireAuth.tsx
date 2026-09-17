import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { PageLoader } from '../components/PageLoader'
import type { PermissionKey, Role } from '../types'
import { useAuth } from './AuthContext'
import { hasPermission } from './permissions'

export function RequireAuth({
  children,
  roles,
  permission,
}: {
  children: ReactNode
  roles?: Role[]
  permission?: PermissionKey
}) {
  const { user, ready } = useAuth()
  if (!ready) return <PageLoader label="Checking access…" />
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  if (permission && !hasPermission(user, permission)) return <Navigate to="/" replace />
  return children
}
