import type { PermissionKey, SessionUser } from '../types'

export const PERMISSION_CATALOG: {
  key: PermissionKey
  section: string
  label: string
  hint: string
}[] = [
  {
    key: 'viewDashboard',
    section: 'Dashboard',
    label: 'Open dashboard',
    hint: 'See the home page and sold quantities',
  },
  {
    key: 'viewAmounts',
    section: 'Dashboard',
    label: 'See rupee amounts',
    hint: 'Show rates, totals, and net earned everywhere',
  },
  {
    key: 'exportReports',
    section: 'Dashboard',
    label: 'Export monthly CSV',
    hint: 'Download employee sales for a month',
  },
  {
    key: 'viewEmployees',
    section: 'Employees',
    label: 'View employees',
    hint: 'Open the employee list and sales sheets',
  },
  {
    key: 'addEmployees',
    section: 'Employees',
    label: 'Add employees',
    hint: 'Create a new employee record',
  },
  {
    key: 'removeEmployees',
    section: 'Employees',
    label: 'Remove employees',
    hint: 'Delete an employee and their sales',
  },
  {
    key: 'recordSales',
    section: 'Sales',
    label: 'Save sales',
    hint: 'Enter a new daily sales sheet',
  },
  {
    key: 'editSales',
    section: 'Sales',
    label: 'Edit sales',
    hint: 'Change an existing saved entry',
  },
  {
    key: 'deleteSales',
    section: 'Sales',
    label: 'Delete sales',
    hint: 'Remove a saved entry',
  },
  {
    key: 'manageRates',
    section: 'Products',
    label: 'Product rates',
    hint: 'Open product rates and change prices',
  },
]

export const ALL_PERMISSIONS = PERMISSION_CATALOG.map((item) => item.key)

export function hasPermission(user: SessionUser | null | undefined, key: PermissionKey) {
  if (!user) return false
  if (user.role === 'admin') return true
  return (user.permissions ?? []).includes(key)
}
