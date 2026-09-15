import { FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { formatMoney } from '../format'
import { getEmployee, listProducts, listSales, recordSale, updateSale, deleteSale } from '../services/salesStore'
import { canDeleteSales, canEditSales, canViewAmounts } from '../auth/permissions'
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

function isAttendanceProduct(product: Product) {
  return product.id === 'attendants' || /attendant/i.test(product.name)
}

function unitLabel(unit: string, quantity: number) {
  return `${quantity} ${unit}${quantity === 1 ? '' : 's'}`
}

export function RecordSalesPage() {
  const { employeeId } = useParams()
  const { user } = useAuth()
  const showAmounts = Boolean(user && canViewAmounts(user.role))
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

  const absent = attendance === 'absent'
  const canEdit = Boolean(user && canEditSales(user.role))

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
      <section className="card">
        <p className="muted">Loading…</p>
      </section>
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
    const quantity = Number(quantities[product.id] || 0)
    return sum + quantity * product.rate
  }, 0)
  const previewTotal = absent ? 0 : previewSales + ATTENDANCE_PAY[attendance]
  const previewExpenses = Number(expenses || 0)
  const previewNet = previewTotal - previewExpenses

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
        </p>
        <form onSubmit={onSubmit}>
          <label>
            Sale date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Attendants
            <select
              value={attendance}
              onChange={(e) => onAttendanceChange(e.target.value as Attendance)}
            >
              <option value="full">{showAmounts ? 'Full day — ₹100' : 'Full day'}</option>
              <option value="half">{showAmounts ? 'Half day — ₹50' : 'Half day'}</option>
              <option value="absent">{showAmounts ? 'Absent — ₹0' : 'Absent'}</option>
            </select>
          </label>
          <table className="sales-table">
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
                    <td>
                      <strong>{product.name}</strong>
                    </td>
                    {showAmounts && (
                      <td>
                        {formatMoney(product.rate)} / {product.unit}
                      </td>
                    )}
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder={`0 ${product.unit}s`}
                        value={quantities[product.id] ?? ''}
                        disabled={absent}
                        onChange={(e) =>
                          setQuantities((current) => ({ ...current, [product.id]: e.target.value }))
                        }
                      />
                    </td>
                    {showAmounts && (
                      <td>{formatMoney(absent ? 0 : quantity * product.rate)}</td>
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
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="submit">{editingId ? 'Update sales' : 'Save sales'}</button>
            {editingId && (
              <button type="button" className="secondary" onClick={cancelEdit}>
                Cancel edit
              </button>
            )}
            <Link to="/employees">Back</Link>
          </div>
        </form>
      </article>
      <article className="card">
        <h3>Saved entries</h3>
        {history.length === 0 ? (
          <p className="muted">No sales recorded yet.</p>
        ) : (
          history.map((sale) => (
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
                  </span>
                )}
                {canEdit && (
                  <button type="button" className="secondary" onClick={() => startEdit(sale)}>
                    Edit
                  </button>
                )}
                {user && canDeleteSales(user.role) && (
                  <button
                    type="button"
                    className="danger"
                    onClick={async () => {
                      await deleteSale(sale.id)
                      await refreshHistory(employeeId!)
                    }}
                  >
                    Delete
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
