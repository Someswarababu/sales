export type Role = 'admin' | 'manager'

export type PermissionKey =
  | 'viewDashboard'
  | 'viewAmounts'
  | 'exportReports'
  | 'viewEmployees'
  | 'addEmployees'
  | 'removeEmployees'
  | 'recordSales'
  | 'editSales'
  | 'deleteSales'
  | 'manageRates'

export type Attendance = 'full' | 'half' | 'absent'

export type Product = {
  id: string
  name: string
  unit: string
  rate: number
}

export type Employee = {
  id: string
  name: string
  route: string
  totalEarned?: number
}

export type SaleLine = {
  productId: string
  quantity: number
  rate: number
  amount: number
}

export type SaleRecord = {
  id: string
  employeeId: string
  date: string
  attendance: Attendance
  lines: SaleLine[]
  total: number
  expenses: number
  net: number
  recordedBy: string
  recordedAt: string
}

export type SessionUser = {
  id: string
  name: string
  username: string
  role: Role
  permissions: PermissionKey[]
}
