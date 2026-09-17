import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'
import { ThemeToggle } from './ThemeToggle'

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

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
        <ThemeToggle className="icon-only" />
      </header>
      <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />
      <aside className="sidebar">
        <div className="brand">
          <strong>Employee Salary Portal</strong>
          <span>
            {user?.role === 'admin'
              ? 'Admin · full access'
              : `${user?.role ?? 'User'} · assigned access`}
          </span>
        </div>
        <nav>
          {hasPermission(user, 'viewDashboard') && (
            <NavLink to="/" end>
              Dashboard
            </NavLink>
          )}
          {hasPermission(user, 'viewEmployees') && <NavLink to="/employees">Employees</NavLink>}
          {hasPermission(user, 'manageRates') && <NavLink to="/products">Product rates</NavLink>}
          {user?.role === 'admin' && <NavLink to="/access">Role access</NavLink>}
        </nav>
        <ThemeToggle className="ghost" />
        <button
          className="ghost"
          onClick={() => {
            setSigningOut(true)
            logout()
            navigate('/login')
          }}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
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
