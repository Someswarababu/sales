import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'
import { PageLoader } from '../components/PageLoader'
import { formatMoney } from '../format'
import {
  buildEmployeeMonthCsv,
  currentMonthValue,
  downloadCsv,
  monthLabel,
  previousMonthValue,
} from '../exportMonth'
import { listEmployees, listProducts, listSales } from '../services/salesStore'
import { startLoading, stopLoading } from '../services/loading'
import { isBalanceProduct, isLoadingProduct, balanceAmount, loadingAmount, monthOverallNet, saleOverallTotal } from '../productFlags'
import type { Employee, Product, SaleRecord } from '../types'

export function DashboardPage() {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [month, setMonth] = useState(currentMonthValue)

  const canSeeDashboard = hasPermission(user, 'viewDashboard')
  const showAmounts = hasPermission(user, 'viewAmounts')
  const canSeeBalance = user?.role === 'admin'
  const canExport = hasPermission(user, 'exportReports')
  const thisMonth = currentMonthValue()
  const lastMonth = previousMonthValue()

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
  const monthTotal = monthOverallNet(monthSales, products, canSeeBalance)
  const monthSalesAmount = monthSales.reduce((sum, sale) => sum + saleOverallTotal(sale, products), 0)
  const monthExpenses = monthSales.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0)
  const monthLoading = monthSales.reduce((sum, sale) => sum + loadingAmount(sale, products), 0)
  const monthBalance = monthSales.reduce((sum, sale) => sum + balanceAmount(sale, products), 0)

  const visibleProducts = products.filter((product) => canSeeBalance || !isBalanceProduct(product))
  const productTotals = visibleProducts.map((product) => {
    const quantity = monthSales.reduce((sum, sale) => {
      const line = sale.lines.find((item) => item.productId === product.id)
      return sum + (line?.quantity ?? 0)
    }, 0)
    const amount = monthSales.reduce((sum, sale) => {
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
      const csv = buildEmployeeMonthCsv(month, employees, visibleProducts, sales, canSeeBalance)
      downloadCsv(`employee-sales-${month}.csv`, csv)
    } finally {
      stopLoading()
      setExporting(false)
    }
  }

  function monthControls() {
    return (
      <article className="card">
        <h3>{monthLabel(month)}</h3>
        <p className="muted">
          {monthSales.length} sale entr{monthSales.length === 1 ? 'y' : 'ies'} in this month. Choose
          another month to see its sales, expenses, net earned, and loading.
        </p>
        <label>
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </label>
        <div className="actions" style={{ margin: '0.9rem 0 0' }}>
          <button
            type="button"
            className="secondary"
            disabled={month === thisMonth}
            onClick={() => setMonth(thisMonth)}
          >
            This month
          </button>
          <button
            type="button"
            className="secondary"
            disabled={month === lastMonth}
            onClick={() => setMonth(lastMonth)}
          >
            Previous month
          </button>
        </div>
      </article>
    )
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
        {monthControls()}
        <article className="card">
          <h3>Quantities sold · {monthLabel(month)}</h3>
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
                      {isBalanceProduct(product) ? ' (admin, subtracted once from the month)' : ''}
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
      {monthControls()}
      <section className="grid-3">
        <article className="card">
          <p className="muted">Sales · {monthLabel(month)}</p>
          <h2>{loading ? 'Loading…' : formatMoney(monthSalesAmount)}</h2>
        </article>
        <article className="card">
          <p className="muted">Expenses · {monthLabel(month)}</p>
          <h2>{loading ? 'Loading…' : formatMoney(monthExpenses)}</h2>
        </article>
        <article className="card">
          <p className="muted">Net earned · {monthLabel(month)}</p>
          <h2>{loading ? 'Loading…' : formatMoney(monthTotal)}</h2>
        </article>
        <article className="card">
          <p className="muted">Loading (separate) · {monthLabel(month)}</p>
          <h2>{loading ? 'Loading…' : formatMoney(monthLoading)}</h2>
        </article>
        {canSeeBalance && (
          <article className="card">
            <p className="muted">Balance deducted · {monthLabel(month)}</p>
            <h2>{loading ? 'Loading…' : formatMoney(monthBalance)}</h2>
          </article>
        )}
      </section>
      <article className="card">
        <h3>Monthly employee export</h3>
        <p className="muted">
          Download {monthLabel(month)}. One employee at a time: every day of the month is a row.
          Missed days are marked Record not there.
        </p>
        {canExport ? (
          <form className="form-grid" onSubmit={onExport}>
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
        <h3>Product totals · {monthLabel(month)}</h3>
        <p className="muted">
          Product totals are sales only. Day expenses are subtracted from each day. Balance is subtracted once from the month, and only admins see it.
        </p>
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
                    {isBalanceProduct(product) ? ' (admin, subtracted once from the month)' : ''}
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
