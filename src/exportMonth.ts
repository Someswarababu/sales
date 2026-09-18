import type { Employee, Product, SaleRecord } from './types'
import { isBalanceProduct, isLoadingProduct, monthOverallNet, saleOverallTotal } from './productFlags'

function csvCell(value: string | number) {
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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

export function buildEmployeeMonthCsv(
  month: string,
  employees: Employee[],
  products: Product[],
  sales: SaleRecord[],
  deductMonthBalance = false,
) {
  const monthSales = sales.filter((sale) => sale.date.startsWith(month))
  const lines: string[] = []

  lines.push(`Employee monthly report,${csvCell(monthLabel(month))}`)
  lines.push('')
  lines.push(
    [
      'Employee',
      'Route',
      'Sale entries',
      ...products.map((product) =>
        isLoadingProduct(product)
          ? `${product.name} (${product.unit}, not in total)`
          : isBalanceProduct(product)
            ? `${product.name} (${product.unit}, deducted from net)`
            : `${product.name} (${product.unit})`,
      ),
      'Sales (INR)',
      'Expenses (INR)',
      'Net earned (INR)',
    ].join(','),
  )

  for (const employee of employees) {
    const employeeSales = monthSales.filter((sale) => sale.employeeId === employee.id)
    const quantities = products.map((product) =>
      employeeSales.reduce((sum, sale) => {
        const line = sale.lines.find((item) => item.productId === product.id)
        return sum + (line?.quantity ?? 0)
      }, 0),
    )
    const total = employeeSales.reduce((sum, sale) => sum + saleOverallTotal(sale, products), 0)
    const expenses = employeeSales.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0)
    const net = monthOverallNet(employeeSales, products, deductMonthBalance)
    lines.push(
      [
        csvCell(employee.name),
        csvCell(employee.route),
        employeeSales.length,
        ...quantities,
        total,
        expenses,
        net,
      ].join(','),
    )
  }

  const grandQuantities = products.map((product) =>
    monthSales.reduce((sum, sale) => {
      const line = sale.lines.find((item) => item.productId === product.id)
      return sum + (line?.quantity ?? 0)
    }, 0),
  )
  const grandTotal = monthSales.reduce((sum, sale) => sum + saleOverallTotal(sale, products), 0)
  const grandExpenses = monthSales.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0)
  const grandNet = monthOverallNet(monthSales, products, deductMonthBalance)
  lines.push(
    ['All employees', '', monthSales.length, ...grandQuantities, grandTotal, grandExpenses, grandNet].join(
      ',',
    ),
  )

  lines.push('')
  lines.push('Detailed sales')
  lines.push('Date,Employee,Route,Product,Quantity,Unit,Rate,Amount,Day expenses,Day net,Recorded by')
  for (const sale of [...monthSales].sort((a, b) => a.date.localeCompare(b.date))) {
    const employee = employees.find((item) => item.id === sale.employeeId)
    const productLines = sale.lines.filter((item) => item.quantity > 0).filter((item) => {
      const product = products.find((row) => row.id === item.productId)
      return deductMonthBalance || !isBalanceProduct(product, item.productId)
    })
    productLines.forEach((line, index) => {
      const product = products.find((item) => item.id === line.productId)
      lines.push(
        [
          sale.date,
          csvCell(employee?.name ?? ''),
          csvCell(employee?.route ?? ''),
          csvCell(product?.name ?? line.productId),
          line.quantity,
          csvCell(product?.unit ?? ''),
          line.rate,
          line.amount,
          index === 0 ? (sale.expenses ?? 0) : '',
          index === 0 ? saleOverallTotal(sale, products) - (sale.expenses ?? 0) : '',
          csvCell(sale.recordedBy),
        ].join(','),
      )
    })
  }

  return lines.join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
