import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { canViewReports } from '../auth/permissions'
import { formatMoney } from '../format'
import {
  buildEmployeeMonthCsv,
  downloadCsv,
  monthLabel,
  previousMonthValue,
} from '../exportMonth'
import { listEmployees, listProducts, listSales } from '../services/salesStore'
import type { Employee, Product, SaleRecord } from '../types'

export function DashboardPage() {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(previousMonthValue)

  useEffect(() => {
    Promise.all([listProducts(), listSales(), listEmployees()])
      .then(([productList, saleList, employeeList]) => {
        setProducts(productList)
        setSales(saleList)
        setEmployees(employeeList)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load dashboard'))
      .finally(() => setLoading(false))
  }, [])

  const monthSales = sales.filter((sale) => sale.date.startsWith(month))
  const monthTotal = monthSales.reduce((sum, sale) => sum + (sale.net ?? sale.total), 0)
  const grandTotal = sales.reduce((sum, sale) => sum + (sale.net ?? sale.total), 0)
  const grandSales = sales.reduce((sum, sale) => sum + sale.total, 0)
  const grandExpenses = sales.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0)

  const productTotals = products.map((product) => {
    const quantity = sales.reduce((sum, sale) => {
      const line = sale.lines.find((item) => item.productId === product.id)
      return sum + (line?.quantity ?? 0)
    }, 0)
    const amount = sales.reduce((sum, sale) => {
      const line = sale.lines.find((item) => item.productId === product.id)
      return sum + (line?.amount ?? 0)
    }, 0)
    return { product, quantity, amount }
  })

  function onExport(event: FormEvent) {
    event.preventDefault()
    const csv = buildEmployeeMonthCsv(month, employees, products, sales)
    downloadCsv(`employee-sales-${month}.csv`, csv)
  }

  if (user && !canViewReports(user.role)) {
    return (
      <section className="stack">
        <article className="card">
          <h2>Write sales</h2>
          <p className="muted">
            Manager access is quantity-only. Enter sold units for employees. You cannot see rupee
            amounts, change rates, add or remove employees, or delete records.
          </p>
          <Link to="/employees">Enter sales</Link>
        </article>
        <article className="card">
          <h3>Quantities sold</h3>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : error ? (
            <p className="error">{error}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Sold</th>
                </tr>
              </thead>
              <tbody>
                {productTotals.map(({ product, quantity }) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>
                      {quantity} {product.unit}
                      {quantity === 1 ? '' : 's'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      </section>
    )
  }

  return (
    <section className="stack">
      {error && (
        <article className="card">
          <p className="error">{error}</p>
        </article>
      )}
      <section className="grid-3">
        <article className="card">
          <p className="muted">Sales</p>
          <h2>{loading ? '…' : formatMoney(grandSales)}</h2>
        </article>
        <article className="card">
          <p className="muted">Expenses</p>
          <h2>{loading ? '…' : formatMoney(grandExpenses)}</h2>
        </article>
        <article className="card">
          <p className="muted">Net earned</p>
          <h2>{loading ? '…' : formatMoney(grandTotal)}</h2>
        </article>
      </section>
      <article className="card">
        <h3>Monthly employee export</h3>
        <p className="muted">
          At the start of each month, export the previous month’s overall employee sales. The month
          picker defaults to {monthLabel(previousMonthValue())}.
        </p>
        <form className="form-grid" onSubmit={onExport}>
          <label>
            Month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
          </label>
          <div className="actions full">
            <button type="submit" disabled={loading}>
              Export {monthLabel(month)} CSV
            </button>
            <span className="muted">
              {monthSales.length} sale entries, {formatMoney(monthTotal)} net
            </span>
          </div>
        </form>
      </article>
      <article className="card">
        <h3>Product totals</h3>
        <p className="muted">Product totals are sales only. Day expenses are subtracted once from the overall total.</p>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Sold</th>
                <th>Sales</th>
              </tr>
            </thead>
            <tbody>
              {productTotals.map(({ product, quantity, amount }) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>
                    {quantity} {product.unit}
                    {quantity === 1 ? '' : 's'}
                  </td>
                  <td>{formatMoney(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  )
}
