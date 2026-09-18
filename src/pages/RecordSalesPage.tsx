import { FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatMoney } from '../format'
import { getEmployee, listEmployees, listProducts, listSales, recordSale, updateSale, deleteSale } from '../services/salesStore'
import { hasPermission } from '../auth/permissions'
import { PageLoader } from '../components/PageLoader'
import { currentMonthValue, monthLabel, previousMonthValue } from '../exportMonth'
import { isAttendanceProduct, isBalanceProduct, isLoadingProduct, isRouteProduct, balanceAmount, loadingAmount, monthOverallNet, saleOverallNet, saleOverallTotal } from '../productFlags'
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

const ROUTE_COUNTS = [1, 2, 3, 4, 5]
const PERSON_COUNTS = [1, 2, 3, 4, 5]

type RouteTripDraft = { persons: number; ids: string[] }

function resizeTrips(trips: RouteTripDraft[], count: number): RouteTripDraft[] {
  return Array.from({ length: count }, (_, index) => trips[index] ?? { persons: 1, ids: [] })
}

function tripShare(trips: RouteTripDraft[]) {
  return trips.reduce((sum, trip) => sum + 1 / Math.max(1, trip.persons), 0)
}

function creditedRoutes(sale: SaleRecord | null | undefined) {
  return (sale?.routeCredits ?? []).reduce((sum, credit) => sum + credit.quantity, 0)
}

function savedTrips(sale: SaleRecord, products: Product[]): RouteTripDraft[] {
  if (sale.attendance === 'absent') return []
  if (sale.routeTrips?.length) {
    return sale.routeTrips.map((trip) => ({ persons: Math.max(1, trip.persons), ids: [...trip.ids] }))
  }
  const routeProduct = products.find((product) => isRouteProduct(product))
  const lineQty = sale.lines.find((line) => line.productId === routeProduct?.id)?.quantity ?? 0
  const ownQty = Math.max(0, (sale.routeCount ?? lineQty) - creditedRoutes(sale))
  const count = Math.floor(ownQty + 0.001)
  if (count < 1) return []
  const persons = Math.max(1, sale.routePersonCount ?? 1)
  const ids = (sale.routePersonId ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  return Array.from({ length: count }, () => ({ persons, ids: [...ids] }))
}

function tripSummary(trips: RouteTripDraft[] | SaleRecord['routeTrips']) {
  if (!trips?.length) return ''
  return trips
    .map((trip, index) => {
      const names = 'names' in trip && trip.names?.length ? trip.names : null
      return `R${index + 1}: ${names ? `with ${names.join(', ')}` : 'alone'}`
    })
    .join(' · ')
}

function creditSummary(sale: SaleRecord) {
  if (!sale.routeCredits?.length) return ''
  return sale.routeCredits
    .map((credit) => `${round2(credit.quantity)} route from ${credit.fromName}`)
    .join(' · ')
}

function unitLabel(unit: string, quantity: number) {
  return `${round2(quantity)} ${unit}${quantity === 1 ? '' : 's'}`
}

function round2(value: number) {
  return Math.round(value * 100) / 100
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
  const [routeTrips, setRouteTrips] = useState<RouteTripDraft[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
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

    Promise.all([getEmployee(employeeId), listProducts(), listSales(employeeId), listEmployees()])
      .then(([found, productList, sales, employeeList]) => {
        setEmployee(found)
        setProducts(productList)
        setQuantities(Object.fromEntries(productList.map((product) => [product.id, ''])))
        setHistory(sales)
        setEmployees(employeeList)
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

  const canSeeBalance = user?.role === 'admin'
  const editingSale = editingId ? history.find((sale) => sale.id === editingId) ?? null : null
  const creditedShare = absent ? 0 : creditedRoutes(editingSale)
  const routeShare = tripShare(routeTrips) + creditedShare
  const otherProducts = products.filter(
    (product) => !isAttendanceProduct(product) && (canSeeBalance || !isBalanceProduct(product)),
  )
  const previewSales = otherProducts.reduce((sum, product) => {
    if (isLoadingProduct(product) || isBalanceProduct(product)) return sum
    const quantity = Number(quantities[product.id] || 0)
    const share = isRouteProduct(product) ? routeShare : quantity
    return sum + share * product.rate
  }, 0)
  const previewLoading = otherProducts.reduce((sum, product) => {
    if (!isLoadingProduct(product)) return sum
    const quantity = Number(quantities[product.id] || 0)
    return sum + quantity * product.rate
  }, 0)
  const previewBalance = otherProducts.reduce((sum, product) => {
    if (!isBalanceProduct(product)) return sum
    const quantity = Number(quantities[product.id] || 0)
    return sum + quantity
  }, 0)
  const previewTotal = absent ? 0 : previewSales + ATTENDANCE_PAY[attendance]
  const previewExpenses = Number(expenses || 0)
  const previewNet = previewTotal - previewExpenses

  const monthHistory = history.filter((sale) => sale.date.startsWith(month))
  const monthLoading = monthHistory.reduce((sum, sale) => sum + loadingAmount(sale, products), 0)
  const monthBalance = monthHistory.reduce((sum, sale) => sum + balanceAmount(sale, products), 0)
  const monthSales = monthHistory.reduce((sum, sale) => sum + saleOverallTotal(sale, products), 0)
  const monthExpenses = monthHistory.reduce((sum, sale) => sum + (sale.expenses ?? 0), 0)
  const liveMonthBalance =
    monthBalance -
    (editingSale && editingSale.date.startsWith(month) ? balanceAmount(editingSale, products) : 0) +
    (canSeeBalance && !absent && date.startsWith(month) ? previewBalance : 0)
  const monthNet =
    monthOverallNet(monthHistory, products, false) - (canSeeBalance ? liveMonthBalance : 0)
  const daysPresent = monthHistory.filter((sale) => sale.attendance !== 'absent').length
  const thisMonth = currentMonthValue()
  const lastMonth = previousMonthValue()

  function onAttendanceChange(value: Attendance) {
    setAttendance(value)
    if (value === 'absent') {
      setQuantities((current) =>
        Object.fromEntries(Object.keys(current).map((id) => [id, ''])),
      )
      setRouteTrips([])
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
      routeTrips: absent
        ? []
        : routeTrips.map((trip) => ({ persons: trip.persons, ids: trip.ids.filter(Boolean) })),
    }
    const unfinished = payload.routeTrips.findIndex((trip) => trip.ids.length !== trip.persons - 1)
    if (unfinished >= 0) {
      setError(`Select who went on route ${unfinished + 1}.`)
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateSale(editingId, payload)
      } else {
        await recordSale(payload)
      }
      setQuantities(Object.fromEntries(products.map((product) => [product.id, ''])))
      setRouteTrips([])
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
          if (isRouteProduct(product)) {
            const own = savedTrips(sale, products).length
            return [product.id, own ? String(own) : '']
          }
          return [product.id, line && line.quantity ? String(line.quantity) : '']
        }),
      ),
    )
    setRouteTrips(savedTrips(sale, products))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setError('')
    setAttendance('full')
    setExpenses('0')
    setDate(new Date().toISOString().slice(0, 10))
    setQuantities(Object.fromEntries(products.map((product) => [product.id, ''])))
    setRouteTrips([])
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
                      {isBalanceProduct(product) && showAmounts && (
                        <span className="muted"> · enter rupees; subtracted from net earned</span>
                      )}
                      {isRouteProduct(product) && (
                        <span className="muted"> · each route split by the persons on that route</span>
                      )}
                    </td>
                    {showAmounts && (
                      <td data-label="Rate">
                        {isBalanceProduct(product) ? '₹ amount' : `${formatMoney(product.rate)} / ${product.unit}`}
                      </td>
                    )}
                    <td data-label="Quantity sold">
                      {isRouteProduct(product) ? (
                        <div className="route-fields">
                          <div className="route-row">
                            <select
                              value={routeTrips.length || ''}
                              disabled={absent || fieldsLocked || actionBusy}
                              onChange={(e) => {
                                const count = Number(e.target.value || 0)
                                setQuantities((current) => ({
                                  ...current,
                                  [product.id]: count ? String(count) : '',
                                }))
                                setRouteTrips((current) => resizeTrips(current, count))
                              }}
                            >
                              <option value="">No. of routes</option>
                              {ROUTE_COUNTS.map((count) => (
                                <option key={count} value={count}>
                                  {count}
                                </option>
                              ))}
                            </select>
                            <span className="muted">routes</span>
                            {showAmounts && routeShare > 0 && (
                              <span className="muted route-share">= {formatMoney(routeShare * product.rate)}</span>
                            )}
                          </div>
                          {routeTrips.map((trip, tripIndex) => (
                            <div className="route-row" key={tripIndex}>
                              <span className="route-tag">Route {tripIndex + 1}</span>
                              <select
                                value={trip.persons}
                                disabled={absent || fieldsLocked || actionBusy}
                                onChange={(e) => {
                                  const persons = Math.max(1, Number(e.target.value) || 1)
                                  setRouteTrips((current) =>
                                    current.map((item, index) =>
                                      index === tripIndex
                                        ? { persons, ids: item.ids.slice(0, persons - 1) }
                                        : item,
                                    ),
                                  )
                                }}
                              >
                                {PERSON_COUNTS.map((count) => (
                                  <option key={count} value={count}>
                                    {count}
                                  </option>
                                ))}
                              </select>
                              <span className="muted">persons</span>
                              {Array.from({ length: trip.persons - 1 }).map((_, slot) => (
                                <select
                                  key={slot}
                                  value={trip.ids[slot] ?? ''}
                                  disabled={absent || fieldsLocked || actionBusy}
                                  onChange={(e) => {
                                    const value = e.target.value
                                    setRouteTrips((current) =>
                                      current.map((item, index) => {
                                        if (index !== tripIndex) return item
                                        const ids = Array.from(
                                          { length: item.persons - 1 },
                                          (_, position) => item.ids[position] ?? '',
                                        )
                                        ids[slot] = value
                                        return { ...item, ids }
                                      }),
                                    )
                                  }}
                                >
                                  <option value="">Went with</option>
                                  {employees
                                    .filter(
                                      (item) =>
                                        item.id !== employeeId &&
                                        (!trip.ids.includes(item.id) || trip.ids[slot] === item.id),
                                    )
                                    .map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.name}
                                      </option>
                                    ))}
                                </select>
                              ))}
                              {showAmounts && (
                                <span className="muted route-share">
                                  {formatMoney(product.rate / trip.persons)} each
                                </span>
                              )}
                            </div>
                          ))}
                          {(editingSale?.routeCredits ?? []).map((credit) => (
                            <div className="route-row" key={credit.fromId}>
                              <span className="route-tag">From</span>
                              <span className="muted">
                                {credit.fromName} · {round2(credit.quantity)} route
                                {showAmounts ? ` · ${formatMoney(credit.quantity * product.rate)}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          placeholder={isBalanceProduct(product) ? '₹0' : `0 ${product.unit}s`}
                          value={quantities[product.id] ?? ''}
                          disabled={absent || fieldsLocked || actionBusy}
                          onChange={(e) =>
                            setQuantities((current) => ({ ...current, [product.id]: e.target.value }))
                          }
                        />
                      )}
                    </td>
                    {showAmounts && (
                      <td data-label="Amount">
                        {formatMoney(
                          absent
                            ? 0
                            : isBalanceProduct(product)
                              ? quantity
                              : (isRouteProduct(product) ? routeShare : quantity) * product.rate,
                        )}
                      </td>
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
              {' = day net '}
              <strong>{formatMoney(previewNet)}</strong>
              {canSeeBalance && previewBalance > 0 && !absent && (
                <>
                  {' · Balance '}
                  <strong>{formatMoney(previewBalance)}</strong>
                  {' comes off this month once'}
                </>
              )}
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
            {canSeeBalance && (
              <>
                <p className="muted" style={{ marginTop: '0.8rem' }}>Balance deducted once from this month</p>
                <h2>{formatMoney(liveMonthBalance)}</h2>
              </>
            )}
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
                    {formatMoney(saleOverallTotal(sale, products))} − {formatMoney(sale.expenses ?? 0)} ={' '}
                    {formatMoney(saleOverallNet(sale, products))}
                    {loadingAmount(sale, products) > 0
                      ? ` · Loading ${formatMoney(loadingAmount(sale, products))}`
                      : ''}
                    {canSeeBalance && balanceAmount(sale, products) > 0
                      ? ` · Balance ${formatMoney(balanceAmount(sale, products))} in month total`
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
                      .filter((line) => {
                        const product = products.find((item) => item.id === line.productId)
                        return canSeeBalance || !isBalanceProduct(product, line.productId)
                      })
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
                                    : isRouteProduct(product)
                                      ? `${sale.routeCount || line.quantity} route${
                                          (sale.routeCount || line.quantity) === 1 ? '' : 's'
                                        } · share ${round2(line.quantity)} × ${formatMoney(line.rate)}${
                                          tripSummary(sale.routeTrips)
                                            ? ` · ${tripSummary(sale.routeTrips)}`
                                            : sale.routePersonName
                                              ? ` · went: ${sale.routePersonName}`
                                              : ''
                                        }${creditSummary(sale) ? ` · ${creditSummary(sale)}` : ''}`
                                      : isBalanceProduct(product)
                                        ? `deducted once from this month`
                                        : `${line.quantity} × ${formatMoney(line.rate)}`}
                                </td>
                                <td>{formatMoney(line.amount)}</td>
                              </>
                            ) : (
                              <td>
                                {attendant
                                  ? ATTENDANCE_LABEL[sale.attendance] ?? 'Full day'
                                  : isRouteProduct(product)
                                    ? `${unitLabel(product?.unit ?? 'unit', line.quantity)}${
                                        tripSummary(sale.routeTrips)
                                          ? ` · ${tripSummary(sale.routeTrips)}`
                                          : sale.routePersonName
                                            ? ` · went: ${sale.routePersonName}`
                                            : ''
                                      }${creditSummary(sale) ? ` · ${creditSummary(sale)}` : ''}`
                                    : isBalanceProduct(product)
                                      ? `Balance (month)`
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