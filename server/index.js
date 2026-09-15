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
  listEmployees,
  listProducts,
  listSales,
  loginUser,
  recordSale,
  saveProductRates,
  updateSale,
} from './db.js'

const app = express()
const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod')
const port = Number(process.env.PORT) || 3001
const host = process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1')
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

if (!isProd) {
  app.use(cors())
}
app.use(express.json({ limit: '1mb' }))

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

app.post(
  '/api/login',
  handle((req, res) => {
    res.json(loginUser(req.body ?? {}))
  }),
)

app.get(
  '/api/products',
  handle((_req, res) => {
    res.json(listProducts())
  }),
)

app.put(
  '/api/products',
  handle((req, res) => {
    if (!Array.isArray(req.body)) throw new Error('Products list is required')
    saveProductRates(req.body)
    res.json(listProducts())
  }),
)

app.post(
  '/api/products',
  handle((req, res) => {
    res.status(201).json(addProduct(req.body ?? {}))
  }),
)

app.delete(
  '/api/products/:id',
  handle((req, res) => {
    deleteProduct(req.params.id)
    res.status(204).end()
  }),
)

app.get(
  '/api/employees',
  handle((_req, res) => {
    res.json(listEmployees())
  }),
)

app.get(
  '/api/employees/:id',
  handle((req, res) => {
    const employee = getEmployee(req.params.id)
    if (!employee) throw new Error('Employee not found')
    res.json(employee)
  }),
)

app.post(
  '/api/employees',
  handle((req, res) => {
    res.status(201).json(addEmployee(req.body ?? {}))
  }),
)

app.delete(
  '/api/employees/:id',
  handle((req, res) => {
    deleteEmployee(req.params.id)
    res.status(204).end()
  }),
)

app.get(
  '/api/sales',
  handle((req, res) => {
    const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined
    res.json(listSales(employeeId))
  }),
)

app.post(
  '/api/sales',
  handle((req, res) => {
    res.status(201).json(recordSale(req.body ?? {}))
  }),
)

app.put(
  '/api/sales/:id',
  handle((req, res) => {
    res.json(updateSale(req.params.id, req.body ?? {}))
  }),
)

app.delete(
  '/api/sales/:id',
  handle((req, res) => {
    deleteSale(req.params.id)
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
