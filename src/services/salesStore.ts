import { SESSION_EXPIRED_EVENT, SESSION_TOKEN_KEY } from '../auth/session'
import type { Employee, PermissionKey, Product, SaleRecord, SessionUser } from '../types'
import { loadingLabelFor, startLoading, stopLoading } from './loading'

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY)
  const method = String(options?.method ?? 'GET').toUpperCase()
  startLoading(loadingLabelFor(method, path))
  try {
    let response: Response
    try {
      response = await fetch(path, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options?.headers ?? {}),
        },
        ...options,
      })
    } catch {
      throw new Error('Could not reach the database. Confirm the sales portal is running.')
    }

    if (response.status === 204) return undefined as T

    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (response.status === 401 && !path.includes('/login')) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      }
      throw new Error(typeof body.error === 'string' ? body.error : 'Request failed')
    }
    return body as T
  } finally {
    stopLoading()
  }
}

export function login(username: string, password: string) {
  return api<SessionUser & { token: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function logoutSession() {
  return api<void>('/api/logout', { method: 'POST' })
}

export function getSession() {
  return api<SessionUser>('/api/me')
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api<void>('/api/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

export type RolePermissionRow = {
  role: string
  permissions: PermissionKey[]
  locked: boolean
}

export function listRolePermissions() {
  return api<RolePermissionRow[]>('/api/role-permissions')
}

export function saveRolePermissions(role: string, permissions: PermissionKey[]) {
  return api<RolePermissionRow[]>('/api/role-permissions', {
    method: 'PUT',
    body: JSON.stringify({ role, permissions }),
  })
}

export function listProducts() {
  return api<Product[]>('/api/products')
}

export function saveProductRates(products: Product[]) {
  return api<Product[]>('/api/products', {
    method: 'PUT',
    body: JSON.stringify(products),
  })
}

export function addProduct(input: { name: string; unit: string; rate: number }) {
  return api<Product>('/api/products', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteProduct(productId: string) {
  return api<void>(`/api/products/${productId}`, { method: 'DELETE' })
}

export function listEmployees(month?: string) {
  const query = month ? `?month=${encodeURIComponent(month)}` : ''
  return api<Employee[]>(`/api/employees${query}`)
}

export function getEmployee(id: string) {
  return api<Employee>(`/api/employees/${id}`)
}

export function addEmployee(input: { name: string; route: string }) {
  return api<Employee>('/api/employees', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteEmployee(employeeId: string) {
  return api<void>(`/api/employees/${employeeId}`, { method: 'DELETE' })
}

export function listSales(employeeId?: string) {
  const query = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : ''
  return api<SaleRecord[]>(`/api/sales${query}`)
}

export function recordSale(input: {
  employeeId: string
  date: string
  quantities: Record<string, number>
  expenses: number
  attendance: 'full' | 'half' | 'absent'
  recordedBy: string
  routePersonId?: string
  routePersonCount?: number
  routeTrips?: { persons: number; ids: string[]; portion?: 'full' | 'half' }[]
}) {
  return api<SaleRecord>('/api/sales', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateSale(
  saleId: string,
  input: {
    employeeId: string
    date: string
    quantities: Record<string, number>
    expenses: number
    attendance: 'full' | 'half' | 'absent'
    recordedBy: string
    routePersonId?: string
    routePersonCount?: number
    routeTrips?: { persons: number; ids: string[]; portion?: 'full' | 'half' }[]
  },
) {
  return api<SaleRecord>(`/api/sales/${saleId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function deleteSale(saleId: string) {
  return api<void>(`/api/sales/${saleId}`, { method: 'DELETE' })
}
