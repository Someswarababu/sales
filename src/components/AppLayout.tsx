import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { canManageRates } from '../auth/permissions'

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>Sales Portal</strong>
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
