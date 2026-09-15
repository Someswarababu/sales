import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { canManageEmployees } from '../auth/permissions'
import { formatMoney } from '../format'
import { addEmployee, deleteEmployee, listEmployees } from '../services/salesStore'
import type { Employee } from '../types'

export function EmployeesPage() {
  const { user } = useAuth()
  const canManage = Boolean(user && canManageEmployees(user.role))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [name, setName] = useState('')
  const [route, setRoute] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setEmployees(await listEmployees())
  }

  useEffect(() => {
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load employees'))
      .finally(() => setLoading(false))
  }, [])

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      await addEmployee({ name, route })
      setName('')
      setRoute('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add employee')
    }
  }

  return (
    <section className="stack">
      <section className="card">
        <h2>Employees</h2>
        <p className="muted">
          {canManage
            ? 'Full access: add or remove employees, and enter sales.'
            : 'Write access: enter sales only. You cannot add, edit, or delete employees.'}
        </p>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Route</th>
                {canManage && <th>Net earned</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <strong>{employee.name}</strong>
                  </td>
                  <td>{employee.route}</td>
                  {canManage && <td>{formatMoney(employee.totalEarned ?? 0)}</td>}
                  <td className="actions">
                    <Link to={`/employees/${employee.id}/sales`}>Enter sales</Link>
                    {canManage && (
                      <button
                        type="button"
                        className="danger"
                        onClick={async () => {
                          await deleteEmployee(employee.id)
                          await refresh()
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {canManage && (
        <section className="card">
          <h3>Add employee</h3>
          <form className="form-grid" onSubmit={onAdd}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Route
              <input value={route} onChange={(e) => setRoute(e.target.value)} required />
            </label>
            {error && <p className="error full">{error}</p>}
            <div className="actions full">
              <button type="submit">Add employee</button>
            </div>
          </form>
        </section>
      )}
    </section>
  )
}
