import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { PermissionKey, Role } from '../types'
import { hasPermission } from './permissions'
import { useAuth } from './AuthContext'

export function RequireAuth({
  children,
  roles,
  permission,
}: {
  children: ReactNode
  roles?: Role[]
  permission?: PermissionKey
}) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  if (permission && !hasPermission(user, permission)) return <Navigate to="/" replace />
  return children
}
