import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'
import { formatMoney } from '../format'
import { addEmployee, deleteEmployee, listEmployees } from '../services/salesStore'
import { currentMonthValue, monthLabel } from '../exportMonth'
import { PageLoader } from '../components/PageLoader'
import type { Employee } from '../types'

export function EmployeesPage() {
  const { user } = useAuth()
  const canAdd = hasPermission(user, 'addEmployees')
  const canRemove = hasPermission(user, 'removeEmployees')
  const showAmounts = hasPermission(user, 'viewAmounts')
  const canRecord = hasPermission(user, 'recordSales')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [name, setName] = useState('')
  const [route, setRoute] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const month = currentMonthValue()

  async function refresh() {
    setEmployees(await listEmployees(month))
  }

  useEffect(() => {
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load employees'))
      .finally(() => setLoading(false))
  }, [])

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setError('')
    setAdding(true)
    try {
      await addEmployee({ name, route })
      setName('')
      setRoute('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add employee')
    } finally {
      setAdding(false)
    }
  }

  async function onRemove(id: string) {
    setError('')
    setRemovingId(id)
    try {
      await deleteEmployee(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove employee')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <section className="stack">
      <section className="card">
        <h2>Employees</h2>
        <p className="muted">
          {canAdd && canRemove
            ? 'You can add or remove employees, and open sales sheets.'
            : canAdd
              ? 'You can add employees and open sales sheets. Removing employees is turned off.'
              : canRemove
                ? 'You can remove employees and open sales sheets. Adding employees is turned off.'
                : canRecord
                  ? 'You can open sales sheets. You cannot add or remove employees.'
                  : 'You can view employees. Saving sales is turned off for this role.'}
        </p>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <PageLoader />
        ) : (
          <table className="stack-mobile">
            <thead>
              <tr>
                <th>Name</th>
                <th>Route</th>
                {showAmounts && <th>Net earned · {monthLabel(month)}</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td data-label="Name">
                    <strong>{employee.name}</strong>
                  </td>
                  <td data-label="Route">{employee.route}</td>
                  {showAmounts && (
                    <td data-label={`Net earned · ${monthLabel(month)}`}>
                      {formatMoney(
                        (employee.totalEarned ?? 0) -
                          (user?.role === 'admin' ? employee.balanceAmount ?? 0 : 0),
                      )}
                    </td>
                  )}
                  <td className="actions">
                    <Link to={`/employees/${employee.id}/sales`}>
                      {canRecord ? 'Enter sales' : 'View sales'}
                    </Link>
                    {canRemove && (
                      <button
                        type="button"
                        className="danger"
                        disabled={removingId === employee.id || adding}
                        onClick={() => onRemove(employee.id)}
                      >
                        {removingId === employee.id ? 'Removing…' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {canAdd && (
        <section className="card">
          <h3>Add employee</h3>
          <form className="form-grid" onSubmit={onAdd}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required disabled={adding} />
            </label>
            <label>
              Route
              <input value={route} onChange={(e) => setRoute(e.target.value)} required disabled={adding} />
            </label>
            {error && <p className="error full">{error}</p>}
            <div className="actions full">
              <button type="submit" disabled={adding}>
                {adding ? 'Adding…' : 'Add employee'}
              </button>
            </div>
          </form>
        </section>
      )}
    </section>
  )
}
