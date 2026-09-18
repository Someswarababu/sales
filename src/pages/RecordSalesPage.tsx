import { FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatMoney } from '../format'
import { getEmployee, listProducts, listSales, recordSale, updateSale, deleteSale } from '../services/salesStore'
import { hasPermission } from '../auth/permissions'
import { PageLoader } from '../components/PageLoader'
import { currentMonthValue, monthLabel, previousMonthValue } from '../exportMonth'
import { isAttendanceProduct, isLoadingProduct, isRouteProduct, loadingAmount } from '../productFlags'
import type { Attendance, Employee, Product, SaleRecord } from '../types'

const ATTENDANCE_PAY: Record<Attendance, number> = {
  absent: 0,
  half: 50,
  full: 100,
}

const ATTENDANCE_LABEL: Record<Attendance, string> = {
  absent: 'Absent',
  half: 'Half day',
  full: 'Full day',
}

const ROUTE_FRACTIONS = [0.5, 1, 1.5, 2, 2.5, 3]

function unitLabel(unit: string, quantity: number) {
  return `${quantity} ${unit}${quantity === 1 ? '' : 's'}`
}

export function RecordSalesPage() {
  const { employeeId } = useParams()
  const { user } = useAuth()
  const showAmounts = hasPermission(user, 'viewAmounts')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [attendance, setAttendance] = useState<Attendance>('full')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [expenses, setExpenses] = useState('0')
  const [error, setError] = useState('')
  const [history, setHistory] = useState<SaleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [popup, setPopup] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [month, setMonth] = useState(currentMonthValue)

  const absent = attendance === 'absent'
  const canRecord = hasPermission(user, 'recordSales')
  const canEdit = hasPermission(user, 'editSales')
  const canDelete = hasPermission(user, 'deleteSales')
  const fieldsLocked = (!canRecord && !editingId) || (Boolean(editingId) && !canEdit)
  const actionBusy = saving || Boolean(deletingId)

  async function refreshHistory(id: string) {
    setHistory(await listSales(id))
  }

  useEffect(() => {
    if (!employeeId) {
      setMissing(true)
      setLoading(false)
      return
    }

    Promise.all([getEmployee(employeeId), listProducts(), listSales(employeeId)])
      .then(([found, productList, sales]) => {
        setEmployee(found)
        setProducts(productList)
        setQuantities(Object.fromEntries(productList.map((product) => [product.id, ''])))
        setHistory(sales)
      })
      .catch(() => setMissing(true))
      .finally(() => setLoading(false))
  }, [employeeId])

  if (loading) {
    return (
      <PageLoader label="Loading sales sheet…" />
    )
  }

  if (missing || !employee) {
    return (
      <section className="card">
        <p>Employee not found.</p>
        <Link to="/employees">Back to employees</Link>
      </section>
    )
  }

  const otherProducts = products.filter((product) => !isAttendanceProduct(product))
  const previewSales = otherProducts.reduce((sum, product) => {
    if (isLoadingProduct(product)) return sum
    const quantity = Number(quantities[product.id] || 0)
    return sum + quantity * product.rate
  }, 0)
  const previewLoading = otherProducts.reduce((sum, product) => {
    if (!isLoadingProduct(product)) return sum
    const quantity = Number(quantities[product.id] || 0)
    return sum + quantity * product.rate
  }, 0)
  const previewTotal = absent ? 0 : previewSales + ATTENDANCE_PAY[attendance]
  const previewExpenses = Number(expenses || 0)
  const previewNet = previewTotal - previewExpenses

  const monthHistory = history.filter((sale) => sale.date.startsWith(month))
  const monthLoading = monthHistory.reduce((sum, sale) => sum + loadingAmount(sale, products), 0)
  const monthSales = monthHistory.reduce((sum, sale) => sum + sale.total, 0)
  const monthExpenses = monthHistory.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0)
  const monthNet = monthHistory.reduce(
    (sum, sale) => sum + (sale.net ?? sale.total - (sale.expenses ?? 0)),
    0,
  )
  const daysPresent = monthHistory.filter((sale) => sale.attendance !== 'absent').length
  const thisMonth = currentMonthValue()
  const lastMonth = previousMonthValue()

  function onAttendanceChange(value: Attendance) {
    setAttendance(value)
    if (value === 'absent') {
      setQuantities((current) =>
        Object.fromEntries(Object.keys(current).map((id) => [id, ''])),
      )
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (editingId ? !canEdit : !canRecord) {
      setError('You do not have permission to save this entry.')
      return
    }
    const alreadySaved = history.some((sale) => sale.date === date && sale.id !== editingId)
    if (alreadySaved) {
      setPopup('An entry is already added for this date. You cannot add another entry.')
      return
    }
    const payload = {
      employeeId: employeeId!,
      date,
      attendance,
      quantities: Object.fromEntries(
        products.map((product) => [
          product.id,
          absent || isAttendanceProduct(product) ? 0 : Number(quantities[product.id] || 0),
        ]),
      ),
      expenses: Number(expenses || 0),
      recordedBy: user?.name ?? 'Unknown',
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateSale(editingId, payload)
      } else {
        await recordSale(payload)
      }
      setQuantities(Object.fromEntries(products.map((product) => [product.id, ''])))
      setExpenses('0')
      setAttendance('full')
      setEditingId(null)
      setDate(new Date().toISOString().slice(0, 10))
      await refreshHistory(employeeId!)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save sales'
      if (message.toLowerCase().includes('already added')) {
        setPopup(message)
      } else {
        setError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  function startEdit(sale: SaleRecord) {
    setError('')
    setEditingId(sale.id)
    setDate(sale.date)
    setAttendance(sale.attendance || 'full')
    setExpenses(String(sale.expenses ?? 0))
    setQuantities(
      Object.fromEntries(
        products.map((product) => {
          const line = sale.lines.find((item) => item.productId === product.id)
          if (isAttendanceProduct(product) || sale.attendance === 'absent') return [product.id, '']
          return [product.id, line && line.quantity ? String(line.quantity) : '']
        }),
      ),
    )
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setError('')
    setAttendance('full')
    setExpenses('0')
    setDate(new Date().toISOString().slice(0, 10))
    setQuantities(Object.fromEntries(products.map((product) => [product.id, ''])))
  }

  return (
    <section className="stack">
      <article className="card">
        <p className="muted">Sales sheet{editingId ? ' · editing entry' : ''}</p>
        <h2>{employee.name}</h2>
        <p>{employee.route}</p>
        <p className="muted">
          {showAmounts
            ? 'Attendants: full day ₹100, half day ₹50, absent ₹0. If absent, other products are locked. Expenses can still be entered. Absent days save with no sold quantity.'
            : 'Choose full day, half day, or absent. If absent, other products are locked. Absent days are saved for that date.'}
          {!canRecord && !canEdit ? ' This role can view the sheet but cannot save changes.' : ''}
        </p>
        <form onSubmit={onSubmit}>
          <label>
            Sale date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={fieldsLocked || actionBusy} />
          </label>
          <label>
            Attendants
            <select
              value={attendance}
              onChange={(e) => onAttendanceChange(e.target.value as Attendance)}
              disabled={fieldsLocked || actionBusy}
            >
              <option value="full">{showAmounts ? 'Full day — ₹100' : 'Full day'}</option>
              <option value="half">{showAmounts ? 'Half day — ₹50' : 'Half day'}</option>
              <option value="absent">{showAmounts ? 'Absent — ₹0' : 'Absent'}</option>
            </select>
          </label>
          <table className="sales-table stack-mobile">
            <thead>
              <tr>
                <th>Product</th>
                {showAmounts && <th>Rate</th>}
                <th>Quantity sold</th>
                {showAmounts && <th>Amount</th>}
              </tr>
            </thead>
            <tbody>
              {otherProducts.map((product) => {
                const quantity = Number(quantities[product.id] || 0)
                return (
                  <tr key={product.id}>
                    <td data-label="Product">
                      <strong>{product.name}</strong>
                      {isLoadingProduct(product) && showAmounts && (
                        <span className="muted"> · ₹1, not in overall total</span>
                      )}
                    </td>
                    {showAmounts && (
                      <td data-label="Rate">
                        {formatMoney(product.rate)} / {product.unit}
                      </td>
                    )}
                    <td data-label="Quantity sold">
                      {isRouteProduct(product) ? (
                        <select
                          value={quantities[product.id] ?? ''}
                          disabled={absent || fieldsLocked || actionBusy}
                          onChange={(e) =>
                            setQuantities((current) => ({ ...current, [product.id]: e.target.value }))
                          }
                        >
                          <option value="">No {product.unit}</option>
                          {ROUTE_FRACTIONS.map((fraction) => (
                            <option key={fraction} value={fraction}>
                              {fraction} {product.unit}
                              {showAmounts ? ` — ${formatMoney(fraction * product.rate)}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          placeholder={`0 ${product.unit}s`}
                          value={quantities[product.id] ?? ''}
                          disabled={absent || fieldsLocked || actionBusy}
                          onChange={(e) =>
                            setQuantities((current) => ({ ...current, [product.id]: e.target.value }))
                          }
                        />
                      )}
                    </td>
                    {showAmounts && (
                      <td data-label="Amount">{formatMoney(absent ? 0 : quantity * product.rate)}</td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <label>
            Day expenses
            <input
              type="number"
              min={0}
              step={1}
              value={expenses}
              disabled={fieldsLocked || actionBusy}
              onChange={(e) => setExpenses(e.target.value)}
            />
          </label>
          {showAmounts && (
            <p>
              All product sales: <strong>{formatMoney(previewTotal)}</strong>
              {' − '}
              expenses: <strong>{formatMoney(previewExpenses)}</strong>
              {' = net '}
              <strong>{formatMoney(previewNet)}</strong>
              {previewLoading > 0 && (
                <>
                  {' · Loading (separate): '}
                  <strong>{formatMoney(absent ? 0 : previewLoading)}</strong>
                </>
              )}
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {!fieldsLocked && (
              <button type="submit" disabled={saving || actionBusy}>
                {saving ? (editingId ? 'Updating…' : 'Saving…') : editingId ? 'Update sales' : 'Save sales'}
              </button>
            )}
            {editingId && (
              <button type="button" className="secondary" onClick={cancelEdit} disabled={saving}>
                Cancel edit
              </button>
            )}
            <Link to="/employees">Back</Link>
          </div>
        </form>
      </article>
      <article className="card">
        <h3>{monthLabel(month)} total</h3>
        <p className="muted">
          {employee.name} · {monthHistory.length} day{monthHistory.length === 1 ? '' : 's'} recorded ·{' '}
          {daysPresent} day{daysPresent === 1 ? '' : 's'} present
        </p>
        <label>
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </label>
        <div className="actions" style={{ margin: '0.9rem 0' }}>
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
        {showAmounts && (
          <section className="grid-3">
            <div>
              <p className="muted">Sales</p>
              <h2>{formatMoney(monthSales)}</h2>
            </div>
            <div>
              <p className="muted">Expenses</p>
              <h2>{formatMoney(monthExpenses)}</h2>
            </div>
            <div>
              <p className="muted">Net earned</p>
              <h2>{formatMoney(monthNet)}</h2>
            </div>
          </section>
        )}
        {showAmounts && (
          <div style={{ marginTop: '1rem' }}>
            <p className="muted">Loading (separate, not in total)</p>
            <h2>{formatMoney(monthLoading)}</h2>
          </div>
        )}
      </article>
      <article className="card">
        <h3>Saved entries · {monthLabel(month)}</h3>
        {monthHistory.length === 0 ? (
          <p className="muted">No sales recorded in {monthLabel(month)}.</p>
        ) : (
          monthHistory.map((sale) => (
            <div key={sale.id} className="sale-block">
              <div className="sale-head">
                <strong>
                  {sale.date}
                  {sale.attendance === 'absent' ? ' — Absent' : ` · ${ATTENDANCE_LABEL[sale.attendance] ?? 'Full day'}`}
                </strong>
                {showAmounts && (
                  <span>
                    {formatMoney(sale.total)} − {formatMoney(sale.expenses ?? 0)} ={' '}
                    {formatMoney(sale.net ?? sale.total - (sale.expenses ?? 0))}
                    {loadingAmount(sale, products) > 0
                      ? ` · Loading ${formatMoney(loadingAmount(sale, products))}`
                      : ''}
                  </span>
                )}
                {canEdit && (
                  <button type="button" className="secondary" onClick={() => startEdit(sale)} disabled={saving || Boolean(deletingId)}>
                    Edit
                  </button>
                )}
                {user && canDelete && (
                  <button
                    type="button"
                    className="danger"
                    disabled={saving || Boolean(deletingId)}
                    onClick={async () => {
                      setDeletingId(sale.id)
                      try {
                        await deleteSale(sale.id)
                        await refreshHistory(employeeId!)
                      } finally {
                        setDeletingId(null)
                      }
                    }}
                  >
                    {deletingId === sale.id ? 'Removing…' : 'Delete'}
                  </button>
                )}
              </div>
              <table>
                <tbody>
                  {sale.attendance === 'absent' ? (
                    <tr>
                      <td>Absent</td>
                      {showAmounts ? (
                        <>
                          <td>No sold quantity</td>
                          <td>{formatMoney(0)}</td>
                        </>
                      ) : (
                        <td>No sold quantity</td>
                      )}
                    </tr>
                  ) : (
                    sale.lines
                      .filter((line) => line.quantity > 0 || line.amount > 0)
                      .map((line) => {
                        const product = products.find((item) => item.id === line.productId)
                        const attendant = product ? isAttendanceProduct(product) : false
                        return (
                          <tr key={line.productId}>
                            <td>{attendant ? 'Attendants' : product?.name}</td>
                            {showAmounts ? (
                              <>
                                <td>
                                  {attendant
                                    ? ATTENDANCE_LABEL[sale.attendance] ?? 'Full day'
                                    : `${line.quantity} × ${formatMoney(line.rate)}`}
                                </td>
                                <td>{formatMoney(line.amount)}</td>
                              </>
                            ) : (
                              <td>
                                {attendant
                                  ? ATTENDANCE_LABEL[sale.attendance] ?? 'Full day'
                                  : unitLabel(product?.unit ?? 'unit', line.quantity)}
                              </td>
                            )}
                          </tr>
                        )
                      })
                  )}
                  {(sale.expenses ?? 0) > 0 && (
                    <tr>
                      <td>Day expenses</td>
                      {showAmounts ? (
                        <>
                          <td></td>
                          <td>{formatMoney(sale.expenses)}</td>
                        </>
                      ) : (
                        <td>Recorded</td>
                      )}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))
        )}
      </article>
      {popup && (
        <div className="popup-backdrop" onClick={() => setPopup('')}>
          <div className="popup-card" onClick={(event) => event.stopPropagation()}>
            <h3>Entry already added</h3>
            <p>{popup}</p>
            <div className="actions">
              <button type="button" onClick={() => setPopup('')}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
