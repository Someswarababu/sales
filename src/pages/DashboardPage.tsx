import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'
import { PageLoader } from '../components/PageLoader'
import { formatMoney } from '../format'
import {
  buildEmployeeMonthCsv,
  downloadCsv,
  monthLabel,
  previousMonthValue,
} from '../exportMonth'
import { listEmployees, listProducts, listSales } from '../services/salesStore'
import { startLoading, stopLoading } from '../services/loading'
import { isLoadingProduct, loadingAmount, saleOverallNet, saleOverallTotal } from '../productFlags'
import type { Employee, Product, SaleRecord } from '../types'

export function DashboardPage() {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [month, setMonth] = useState(previousMonthValue)

  const canSeeDashboard = hasPermission(user, 'viewDashboard')
  const showAmounts = hasPermission(user, 'viewAmounts')
  const canExport = hasPermission(user, 'exportReports')

  useEffect(() => {
    if (!canSeeDashboard) {
      setLoading(false)
      return
    }
    Promise.all([listProducts(), listSales(), listEmployees()])
      .then(([productList, saleList, employeeList]) => {
        setProducts(productList)
        setSales(saleList)
        setEmployees(employeeList)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load dashboard'))
      .finally(() => setLoading(false))
  }, [canSeeDashboard])

  const monthSales = sales.filter((sale) => sale.date.startsWith(month))
  const monthTotal = monthSales.reduce((sum, sale) => sum + saleOverallNet(sale, products), 0)
  const grandTotal = sales.reduce((sum, sale) => sum + saleOverallNet(sale, products), 0)
  const grandSales = sales.reduce((sum, sale) => sum + saleOverallTotal(sale, products), 0)
  const grandExpenses = sales.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0)
  const grandLoading = sales.reduce((sum, sale) => sum + loadingAmount(sale, products), 0)

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
    setExporting(true)
    startLoading('Exporting…')
    try {
      const csv = buildEmployeeMonthCsv(month, employees, products, sales)
      downloadCsv(`employee-sales-${month}.csv`, csv)
    } finally {
      stopLoading()
      setExporting(false)
    }
  }

  if (!canSeeDashboard) {
    if (hasPermission(user, 'viewEmployees')) return <Navigate to="/employees" replace />
    if (hasPermission(user, 'manageRates')) return <Navigate to="/products" replace />
    return (
      <section className="card">
        <h2>No dashboard access</h2>
        <p className="muted">Ask an admin to grant access to a section.</p>
      </section>
    )
  }

  if (!showAmounts) {
    return (
      <section className="stack">
        <article className="card">
          <h2>Write sales</h2>
          <p className="muted">
            Quantity-only access. Rupee amounts stay hidden until an admin grants them.
          </p>
          {hasPermission(user, 'viewEmployees') && <Link to="/employees">Enter sales</Link>}
        </article>
        <article className="card">
          <h3>Quantities sold</h3>
          {loading ? (
            <PageLoader />
          ) : error ? (
            <p className="error">{error}</p>
          ) : (
            <table className="stack-mobile">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Sold</th>
                </tr>
              </thead>
              <tbody>
                {productTotals.map(({ product, quantity }) => (
                  <tr key={product.id}>
                    <td data-label="Product">
                      {product.name}
                      {isLoadingProduct(product) ? ' (not in overall total)' : ''}
                    </td>
                    <td data-label="Sold">
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
          <h2>{loading ? 'Loading…' : formatMoney(grandSales)}</h2>
        </article>
        <article className="card">
          <p className="muted">Expenses</p>
          <h2>{loading ? 'Loading…' : formatMoney(grandExpenses)}</h2>
        </article>
        <article className="card">
          <p className="muted">Net earned</p>
          <h2>{loading ? 'Loading…' : formatMoney(grandTotal)}</h2>
        </article>
        <article className="card">
          <p className="muted">Loading (separate)</p>
          <h2>{loading ? 'Loading…' : formatMoney(grandLoading)}</h2>
        </article>
      </section>
      <article className="card">
        <h3>Monthly employee export</h3>
        <p className="muted">
          At the start of each month, export the previous month’s overall employee sales. The month
          picker defaults to {monthLabel(previousMonthValue())}.
        </p>
        {canExport ? (
          <form className="form-grid" onSubmit={onExport}>
            <label>
              Month
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </label>
            <div className="actions full">
              <button type="submit" disabled={loading || exporting}>
                {exporting ? 'Exporting…' : `Export ${monthLabel(month)} CSV`}
              </button>
              <span className="muted">
                {monthSales.length} sale entries, {formatMoney(monthTotal)} net
              </span>
            </div>
          </form>
        ) : (
          <p className="muted">CSV export is turned off for this role.</p>
        )}
      </article>
      <article className="card">
        <h3>Product totals</h3>
        <p className="muted">Product totals are sales only. Day expenses are subtracted once from the overall total.</p>
        {loading ? (
          <PageLoader />
        ) : (
          <table className="stack-mobile">
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
                  <td data-label="Product">
                    {product.name}
                    {isLoadingProduct(product) ? ' (not in overall total)' : ''}
                  </td>
                  <td data-label="Sold">
                    {quantity} {product.unit}
                    {quantity === 1 ? '' : 's'}
                  </td>
                  <td data-label="Sales">{formatMoney(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  )
}
