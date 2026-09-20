import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import {
  addEmployee,
  addProduct,
  deleteEmployee,
  deleteProduct,
  deleteSale,
  getEmployee,
  getUserByToken,
  listEmployees,
  listProducts,
  listRolePermissions,
  listSales,
  changePassword,
  loginUser,
  logoutUser,
  ready,
  recordSale,
  saveProductRates,
  saveRolePermissions,
  updateSale,
} from './db.js'

await ready

const app = express()
const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod')
const port = Number(process.env.PORT) || 3001
const host = process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1')
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

if (!isProd) {
  app.use(cors())
}
app.use(express.json({ limit: '1mb' }))

function hasPerm(user, key) {
  return user.role === 'admin' || (user.permissions ?? []).includes(key)
}

function deny(message, status) {
  const error = new Error(message)
  error.status = status
  throw error
}

function tokenFrom(req) {
  const header = String(req.headers.authorization ?? '')
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      const status = error?.status || (message.includes('not found') ? 404 : 400)
      res.status(status).json({ error: message })
    }
  }
}

function requireUser(fn) {
  return handle(async (req, res) => {
    const user = await getUserByToken(tokenFrom(req))
    if (!user) deny('Sign in required', 401)
    req.user = user
    await fn(req, res)
  })
}

function requirePerm(permission, fn) {
  return requireUser(async (req, res) => {
    if (!hasPerm(req.user, permission)) deny('You do not have access to this section', 403)
    await fn(req, res)
  })
}

function requireAny(permissions, fn) {
  return requireUser(async (req, res) => {
    if (!permissions.some((permission) => hasPerm(req.user, permission))) {
      deny('You do not have access to this section', 403)
    }
    await fn(req, res)
  })
}

function requireAdmin(fn) {
  return requireUser(async (req, res) => {
    if (req.user.role !== 'admin') deny('Admin access required', 403)
    await fn(req, res)
  })
}

app.post(
  '/api/login',
  handle(async (req, res) => {
    res.json(await loginUser(req.body ?? {}))
  }),
)

app.post(
  '/api/logout',
  handle(async (req, res) => {
    await logoutUser(tokenFrom(req))
    res.status(204).end()
  }),
)

app.get(
  '/api/me',
  requireUser(async (req, res) => {
    res.json(req.user)
  }),
)

app.post(
  '/api/change-password',
  requireUser(async (req, res) => {
    await changePassword({
      userId: req.user.id,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword,
    })
    res.status(204).end()
  }),
)

app.get(
  '/api/role-permissions',
  requireAdmin(async (_req, res) => {
    res.json(await listRolePermissions())
  }),
)

app.put(
  '/api/role-permissions',
  requireAdmin(async (req, res) => {
    res.json(await saveRolePermissions(req.body?.role, req.body?.permissions))
  }),
)

app.get(
  '/api/products',
  requireAny(
    ['viewDashboard', 'viewEmployees', 'recordSales', 'manageRates'],
    async (req, res) => {
      const products = await listProducts()
      res.json(
        req.user.role === 'admin'
          ? products
          : products.filter(
              (product) => product.id !== 'balance' && String(product.name).toLowerCase() !== 'balance',
              
            ),
      )
    },
  ),
)

app.put(
  '/api/products',
  requirePerm('manageRates', async (req, res) => {
    if (!Array.isArray(req.body)) throw new Error('Products list is required')
    await saveProductRates(req.body)
    const products = await listProducts()
    res.json(
      req.user.role === 'admin'
        ? products
        : products.filter(
            (product) => product.id !== 'balance' && String(product.name).toLowerCase() !== 'balance',
          ),
    )
  }),
)

app.post(
  '/api/products',
  requirePerm('manageRates', async (req, res) => {
    res.status(201).json(await addProduct(req.body ?? {}))
  }),
)

app.delete(
  '/api/products/:id',
  requirePerm('manageRates', async (req, res) => {
    await deleteProduct(req.params.id)
    res.status(204).end()
  }),
)

app.get(
  '/api/employees',
  requireAny(['viewDashboard', 'viewEmployees', 'addEmployees', 'removeEmployees', 'recordSales'], async (req, res) => {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined
    res.json(await listEmployees(month))
  }),
)

app.get(
  '/api/employees/:id',
  requireAny(['viewEmployees', 'recordSales'], async (req, res) => {
    const employee = await getEmployee(req.params.id)
    if (!employee) throw new Error('Employee not found')
    res.json(employee)
  }),
)

app.post(
  '/api/employees',
  requirePerm('addEmployees', async (req, res) => {
    res.status(201).json(await addEmployee(req.body ?? {}))
  }),
)

app.delete(
  '/api/employees/:id',
  requirePerm('removeEmployees', async (req, res) => {
    await deleteEmployee(req.params.id)
    res.status(204).end()
  }),
)

app.get(
  '/api/sales',
  requireAny(['viewDashboard', 'viewEmployees', 'recordSales', 'editSales'], async (req, res) => {
    const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined
    res.json(await listSales(employeeId))
  }),
)

app.post(
  '/api/sales',
  requirePerm('recordSales', async (req, res) => {
    res.status(201).json(await recordSale(req.body ?? {}))
  }),
)

app.put(
  '/api/sales/:id',
  requirePerm('editSales', async (req, res) => {
    res.json(await updateSale(req.params.id, req.body ?? {}))
  }),
)

app.delete(
  '/api/sales/:id',
  requirePerm('deleteSales', async (req, res) => {
    await deleteSale(req.params.id)
    res.status(204).end()
  }),
)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

if (existsSync(join(distDir, 'index.html'))) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api')) return next()
    res.sendFile(join(distDir, 'index.html'))
  })
} else if (isProd) {
  console.warn('dist/ is missing. Run npm run build before npm start.')
}

const server = app.listen(port, host, () => {
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host
  console.log(`Sales portal running at http://${urlHost}:${port}`)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process and try again.`)
  } else {
    console.error(error)
  }
  process.exit(1)
})
