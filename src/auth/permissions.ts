import type { Role } from '../types'

export function canViewReports(role: Role) {
  return role === 'admin'
}

export function canManageRates(role: Role) {
  return role === 'admin'
}

export function canManageEmployees(role: Role) {
  return role === 'admin'
}

export function canDeleteSales(role: Role) {
  return role === 'admin'
}

export function canEditSales(role: Role) {
  return role === 'admin'
}

export function canViewAmounts(role: Role) {
  return role === 'admin'
}
