import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { canManageRates } from '../auth/permissions'

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <div className={`app-shell${menuOpen ? ' menu-open' : ''}`}>
      <header className="mobile-bar">
        <button
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
        <strong>Employee Salary Portal</strong>
      </header>
      <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />
      <aside className="sidebar">
        <div className="brand">
          <strong>Employee Salary Portal</strong>
          <span>{user?.role === 'admin' ? 'Admin · full access' : 'Manager · write access'}</span>
        </div>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/employees">Employees</NavLink>
          {user && canManageRates(user.role) && <NavLink to="/products">Product rates</NavLink>}
        </nav>
        <button
          className="ghost"
          onClick={() => {
            logout()
            navigate('/login')
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <p className="muted">Signed in as</p>
            <h1>{user?.name}</h1>
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  )
}
