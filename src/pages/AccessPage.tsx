import { FormEvent, useEffect, useMemo, useState } from 'react'
import { PERMISSION_CATALOG } from '../auth/permissions'
import { listRolePermissions, saveRolePermissions } from '../services/salesStore'
import { PageLoader } from '../components/PageLoader'
import type { PermissionKey } from '../types'

export function AccessPage() {
  const [roles, setRoles] = useState<{ role: string; permissions: PermissionKey[]; locked: boolean }[]>([])
  const [selectedRole, setSelectedRole] = useState('manager')
  const [draft, setDraft] = useState<PermissionKey[]>([])
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const current = roles.find((item) => item.role === selectedRole)

  useEffect(() => {
    listRolePermissions()
      .then((rows) => {
        setRoles(rows)
        const firstEditable = rows.find((row) => !row.locked) ?? rows[0]
        const role = firstEditable?.role ?? 'manager'
        setSelectedRole(role)
        setDraft(rows.find((row) => row.role === role)?.permissions ?? [])
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load access'))
      .finally(() => setLoading(false))
  }, [])

  const sections = useMemo(() => {
    const groups = new Map<string, typeof PERMISSION_CATALOG>()
    for (const item of PERMISSION_CATALOG) {
      const list = groups.get(item.section) ?? []
      list.push(item)
      groups.set(item.section, list)
    }
    return [...groups.entries()]
  }, [])

  function onRoleChange(role: string) {
    setSelectedRole(role)
    setSaved(false)
    setDraft(roles.find((item) => item.role === role)?.permissions ?? [])
  }

  function toggle(key: PermissionKey) {
    if (current?.locked) return
    setSaved(false)
    setDraft((currentKeys) =>
      currentKeys.includes(key) ? currentKeys.filter((item) => item !== key) : [...currentKeys, key],
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const rows = await saveRolePermissions(selectedRole, draft)
      setRoles(rows)
      setDraft(rows.find((row) => row.role === selectedRole)?.permissions ?? draft)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save access')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card">
      <h2>Role access</h2>
      <p className="muted">
        Admin keeps full access. Grant each other role the sections and actions they may use. A
        manager must sign in again, or refresh, to pick up changes.
      </p>
      {loading ? (
        <PageLoader />
      ) : (
        <form onSubmit={onSubmit}>
          <label>
            Role
            <select value={selectedRole} onChange={(e) => onRoleChange(e.target.value)} disabled={saving}>
              {roles.map((item) => (
                <option key={item.role} value={item.role}>
                  {item.role}
                  {item.locked ? ' (always full access)' : ''}
                </option>
              ))}
            </select>
          </label>
          {sections.map(([section, items]) => (
            <fieldset key={section} className="permission-group">
              <legend>{section}</legend>
              {items.map((item) => (
                <label key={item.key} className="permission-row">
                  <input
                    type="checkbox"
                    checked={current?.locked || draft.includes(item.key)}
                    disabled={current?.locked || saving}
                    onChange={() => toggle(item.key)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <span className="muted">{item.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="submit" disabled={current?.locked || saving}>
              {saving ? 'Saving…' : 'Save access'}
            </button>
            {saved && <span className="muted">Saved. This role will use the new access on the next page load.</span>}
          </div>
        </form>
      )}
    </section>
  )
}
