import type { Employee, Product, SaleRecord } from './types'
import {
  isAttendanceProduct,
  isBalanceProduct,
  monthOverallNet,
  saleOverallNet,
  saleOverallTotal,
} from './productFlags'

function csvCell(value: string | number) {
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function todayDateValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function previousMonthValue() {
  const now = new Date()
  const monthIndex = now.getMonth() === 0 ? 12 : now.getMonth()
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  return `${year}-${String(monthIndex).padStart(2, '0')}`
}

export function monthLabel(month: string) {
  const [year, monthPart] = month.split('-')
  const date = new Date(Number(year), Number(monthPart) - 1, 1)
  return date.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}

function todayValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function datesInMonth(month: string) {
  const [year, monthPart] = month.split('-')
  const lastDay = new Date(Number(year), Number(monthPart), 0).getDate()
  const today = todayValue()
  const dates: string[] = []
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${year}-${monthPart}-${String(day).padStart(2, '0')}`
    if (date > today) break
    dates.push(date)
  }
  return dates
}

function formatDay(isoDate: string) {
  const [year, monthPart, day] = isoDate.split('-')
  const date = new Date(Number(year), Number(monthPart) - 1, Number(day))
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function dateCell(isoDate: string) {
  return `"${formatDay(isoDate).replaceAll('"', '""')}"`
}

const ATTENDANCE_LABEL: Record<string, string> = {
  absent: 'Absent',
  half: 'Half day',
  full: 'Full day',
}

function soldProducts(products: Product[], deductMonthBalance: boolean) {
  return products.filter((product) => {
    if (isAttendanceProduct(product)) return false
    if (!deductMonthBalance && isBalanceProduct(product)) return false
    return true
  })
}

function productQuantity(sale: SaleRecord, product: Product) {
  return sale.lines.find((line) => line.productId === product.id)?.quantity ?? 0
}

function productQuantities(records: SaleRecord[], products: Product[]) {
  return products.map((product) =>
    records.reduce((sum, sale) => sum + productQuantity(sale, product), 0),
  )
}

function headerRow(products: Product[]) {
  return [
    'Date',
    'Attendance',
    ...products.map((product) => product.name),
    'Expenses',
    'Sales',
    'Day net',
  ].join(',')
}

function dataRow(
  dateLabel: string,
  attendance: string,
  quantities: Array<string | number>,
  expenses: string | number,
  salesAmount: string | number,
  net: string | number,
) {
  return [dateLabel, csvCell(attendance), ...quantities, expenses, salesAmount, net].join(',')
}

export function buildEmployeeMonthCsv(
  month: string,
  employees: Employee[],
  products: Product[],
  sales: SaleRecord[],
  deductMonthBalance = false,
) {
  const monthSales = sales.filter((sale) => sale.date.startsWith(month))
  const items = soldProducts(products, deductMonthBalance)
  const people = [...employees].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const headers = headerRow(items)
  const lines: string[] = []

  lines.push(`Month,${csvCell(monthLabel(month))}`)
  lines.push('')

  for (const employee of people) {
    const employeeSales = monthSales
      .filter((sale) => sale.employeeId === employee.id)
      .sort((a, b) => a.date.localeCompare(b.date))

    lines.push(`Employee,${csvCell(employee.name)},Route,${csvCell(employee.route)}`)
    lines.push(headers)

    const byDate = new Map(employeeSales.map((sale) => [sale.date, sale]))
    for (const date of datesInMonth(month)) {
      const sale = byDate.get(date)
      if (!sale) {
        lines.push(
          dataRow(
            dateCell(date),
            'Record not there',
            items.map(() => ''),
            '',
            '',
            '',
          ),
        )
        continue
      }
      lines.push(
        dataRow(
          dateCell(sale.date),
          ATTENDANCE_LABEL[sale.attendance] ?? 'Full day',
          items.map((product) => productQuantity(sale, product)),
          sale.expenses ?? 0,
          saleOverallTotal(sale, products),
          saleOverallNet(sale, products),
        ),
      )
    }
    if (employeeSales.length === 0) {
      lines.push(
        dataRow(
          'Month total',
          '0 days recorded',
          items.map(() => 0),
          0,
          0,
          0,
        ),
      )
    } else {
      lines.push(
        dataRow(
          'Month total',
          `${employeeSales.length} day${employeeSales.length === 1 ? '' : 's'} recorded`,
          productQuantities(employeeSales, items),
          employeeSales.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0),
          employeeSales.reduce((sum, sale) => sum + saleOverallTotal(sale, products), 0),
          monthOverallNet(employeeSales, products, deductMonthBalance),
        ),
      )
    }
    lines.push('')
  }

  lines.push(`All employees,${csvCell(monthLabel(month))}`)
  lines.push(headers)
  lines.push(
    dataRow(
      'Month total',
      `${monthSales.length} day${monthSales.length === 1 ? '' : 's'}`,
      productQuantities(monthSales, items),
      monthSales.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0),
      monthSales.reduce((sum, sale) => sum + saleOverallTotal(sale, products), 0),
      monthOverallNet(monthSales, products, deductMonthBalance),
    ),
  )

  return lines.join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
