import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/AppLayout'
import { AccessPage } from './pages/AccessPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { LoginPage } from './pages/LoginPage'
import { ProductsPage } from './pages/ProductsPage'
import { RecordSalesPage } from './pages/RecordSalesPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route
          path="employees"
          element={
            <RequireAuth permission="viewEmployees">
              <EmployeesPage />
            </RequireAuth>
          }
        />
        <Route
          path="employees/:employeeId/sales"
          element={
            <RequireAuth permission="viewEmployees">
              <RecordSalesPage />
            </RequireAuth>
          }
        />
        <Route
          path="products"
          element={
            <RequireAuth permission="manageRates">
              <ProductsPage />
            </RequireAuth>
          }
        />
        <Route
          path="access"
          element={
            <RequireAuth roles={['admin']}>
              <AccessPage />
            </RequireAuth>
          }
        />
        <Route path="password" element={<ChangePasswordPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
