import { mkdirSync } from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'

const root = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || join(root, '..', 'data')
const localFile = join(dataDir, 'sales.db').replaceAll('\\', '/')
const remoteUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL
const isRemote = Boolean(remoteUrl)

if (!isRemote) mkdirSync(dataDir, { recursive: true })

const db = createClient({
  url: remoteUrl || `file:${localFile}`,
  authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
})

async function exec(sql, args = []) {
  return db.execute({ sql, args })
}

async function all(sql, args = []) {
  const result = await exec(sql, args)
  return result.rows
}

async function get(sql, args = []) {
  const rows = await all(sql, args)
  return rows[0]
}

async function batch(statements) {
  await db.batch(
    statements.map((item) => (typeof item === 'string' ? { sql: item, args: [] } : item)),
    'write',
  )
}

async function columns(table) {
  const rows = await all(`PRAGMA table_info(${table})`)
  return rows.map((column) => column.name)
}

const PERMISSION_KEYS = [
  'viewDashboard',
  'viewAmounts',
  'exportReports',
  'viewEmployees',
  'addEmployees',
  'removeEmployees',
  'recordSales',
  'editSales',
  'deleteSales',
  'manageRates',
]
const DEFAULT_MANAGER_PERMISSIONS = ['viewDashboard', 'viewEmployees', 'recordSales']

function parsePermissions(value) {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return DEFAULT_MANAGER_PERMISSIONS
    const next = parsed.flatMap((item) =>
      item === 'manageEmployees' ? ['addEmployees', 'removeEmployees'] : [item],
    )
    return [...new Set(next.filter((item) => PERMISSION_KEYS.includes(item)))]
  } catch {
    return DEFAULT_MANAGER_PERMISSIONS
  }
}

function publicUser(user, permissions) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    permissions: user.role === 'admin' ? [...PERMISSION_KEYS] : permissions,
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const next = scryptSync(password, salt, 32)
  const current = Buffer.from(hash, 'hex')
  if (current.length !== next.length) return false
  return timingSafeEqual(current, next)
}

async function migrate() {
  await exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      rate REAL NOT NULL
    );
  `)
  await exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      route TEXT NOT NULL
    );
  `)
  await exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      total REAL NOT NULL,
      recorded_by TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );
  `)
  await exec(`
    CREATE TABLE IF NOT EXISTS sale_lines (
      sale_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL,
      PRIMARY KEY (sale_id, product_id),
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `)
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL
    );
  `)

  if (!isRemote) {
    await exec('PRAGMA journal_mode = WAL')
    await exec('PRAGMA busy_timeout = 5000')
    await exec('PRAGMA foreign_keys = ON')
  }

  const employeeCols = await columns('employees')
  if (employeeCols.includes('email')) {
    await exec('ALTER TABLE employees DROP COLUMN email')
  }

  const userCols = await columns('users')
  if (userCols.includes('email') || !userCols.includes('username') || !userCols.includes('password_hash')) {
    const existing = await all('SELECT * FROM users')
    await exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL
      );
    `)
    for (const user of existing) {
      const username =
        user.username ||
        (user.role === 'admin' ? 'admin' : user.role === 'manager' ? 'manager' : String(user.name).toLowerCase())
      const passwordHash = user.password_hash || hashPassword(username === 'admin' ? 'admin123' : 'manager123')
      await exec('INSERT INTO users_new (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)', [
        user.id,
        user.name,
        username,
        passwordHash,
        user.role,
      ])
    }
    await exec('DROP TABLE users')
    await exec('ALTER TABLE users_new RENAME TO users')
  }

  const productCols = await columns('products')
  if (productCols.includes('expense')) {
    await exec('ALTER TABLE products DROP COLUMN expense')
  }
  const lineCols = await columns('sale_lines')
  if (lineCols.includes('expense')) {
    await exec('ALTER TABLE sale_lines DROP COLUMN expense')
  }
  if (lineCols.includes('expense_amount')) {
    await exec('ALTER TABLE sale_lines DROP COLUMN expense_amount')
  }
  const saleCols = await columns('sales')
  if (!saleCols.includes('expenses')) {
    await exec('ALTER TABLE sales ADD COLUMN expenses REAL NOT NULL DEFAULT 0')
  }
  if (!saleCols.includes('net')) {
    await exec('ALTER TABLE sales ADD COLUMN net REAL NOT NULL DEFAULT 0')
  }
  if (!saleCols.includes('attendance')) {
    await exec("ALTER TABLE sales ADD COLUMN attendance TEXT NOT NULL DEFAULT 'full'")
  }
  if (!saleCols.includes('route_person_id')) {
    await exec('ALTER TABLE sales ADD COLUMN route_person_id TEXT')
  }
  if (!saleCols.includes('route_count')) {
    await exec('ALTER TABLE sales ADD COLUMN route_count REAL NOT NULL DEFAULT 0')
  }
  if (!saleCols.includes('route_person_count')) {
    await exec('ALTER TABLE sales ADD COLUMN route_person_count INTEGER NOT NULL DEFAULT 1')
  }
  if (!saleCols.includes('route_trips')) {
    await exec('ALTER TABLE sales ADD COLUMN route_trips TEXT')
  }
  await exec('UPDATE sales SET net = total - expenses')

  await exec(`
    CREATE TABLE IF NOT EXISTS route_credits (
      source_sale_id TEXT NOT NULL,
      target_employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      PRIMARY KEY (source_sale_id, target_employee_id)
    );
  `)
  const creditInfo = await all('PRAGMA table_info(route_credits)')
  const creditPk = creditInfo.filter((column) => Number(column.pk) > 0).map((column) => column.name)
  if (creditPk.length === 1 && creditPk[0] === 'source_sale_id') {
    await exec(`
      CREATE TABLE route_credits_new (
        source_sale_id TEXT NOT NULL,
        target_employee_id TEXT NOT NULL,
        date TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        PRIMARY KEY (source_sale_id, target_employee_id)
      );
    `)
    await exec(
      'INSERT OR IGNORE INTO route_credits_new (source_sale_id, target_employee_id, date, product_id, quantity) SELECT source_sale_id, target_employee_id, date, product_id, quantity FROM route_credits',
    )
    await exec('DROP TABLE route_credits')
    await exec('ALTER TABLE route_credits_new RENAME TO route_credits')
  }

  await exec(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT PRIMARY KEY,
      permissions TEXT NOT NULL
    );
  `)
  await exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  const managerAccess = await get('SELECT role FROM role_permissions WHERE role = ?', ['manager'])
  if (!managerAccess) {
    await exec('INSERT INTO role_permissions (role, permissions) VALUES (?, ?)', [
      'manager',
      JSON.stringify(DEFAULT_MANAGER_PERMISSIONS),
    ])
  }
}

async function seedIfEmpty() {
  const productCount = await get('SELECT COUNT(*) AS count FROM products')
  if (Number(productCount.count) === 0) {
    const products = [
      ['water', 'Water', 'case', 5],
      ['glass', 'Glass', 'case', 8],
      ['ppt', 'PPT', 'pack', 12],
      ['other-routes', 'Other routes', 'route', 15],
      ['loading', 'Loading', 'unit', 1],
      ['balance', 'Balance', 'rupee', 1],
      ['attendants', 'Attendants', 'person', 20],
    ]
    await batch(
      products.map((row) => ({
        sql: 'INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)',
        args: row,
      })),
    )

    await batch([
      { sql: 'INSERT INTO employees (id, name, route) VALUES (?, ?, ?)', args: ['e-ana', 'Ana', 'City route'] },
      { sql: 'INSERT INTO employees (id, name, route) VALUES (?, ?, ?)', args: ['e-ravi', 'Ravi', 'North route'] },
      { sql: 'INSERT INTO employees (id, name, route) VALUES (?, ?, ?)', args: ['e-meena', 'Meena', 'South route'] },
    ])

    const saleId = 's1'
    const today = new Date().toISOString().slice(0, 10)
    await exec(
      'INSERT INTO sales (id, employee_id, date, total, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
      [saleId, 'e-ana', today, 181, 'Admin', new Date().toISOString()],
    )
    await batch([
      { sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)', args: [saleId, 'water', 10, 5, 50] },
      { sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)', args: [saleId, 'glass', 4, 8, 32] },
      { sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)', args: [saleId, 'ppt', 2, 12, 24] },
      { sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)', args: [saleId, 'other-routes', 1, 15, 15] },
      { sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)', args: [saleId, 'attendants', 3, 20, 60] },
    ])
  }

  const loadingProduct = await get(
    "SELECT id FROM products WHERE id = 'loading' OR lower(name) = 'loading'",
  )
  if (!loadingProduct) {
    await exec('INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)', [
      'loading',
      'Loading',
      'unit',
      1,
    ])
  }

  const balanceProduct = await get(
    "SELECT id FROM products WHERE id = 'balance' OR lower(name) = 'balance'",
  )
  if (!balanceProduct) {
    await exec('INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)', [
      'balance',
      'Balance',
      'rupee',
      1,
    ])
  }

  const attendantProduct = await get(
    "SELECT id FROM products WHERE id = 'attendants' OR lower(name) LIKE '%attendant%'",
  )
  if (!attendantProduct) {
    await exec('INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)', [
      'attendants',
      'Attendants',
      'person',
      100,
    ])
  }

  const userCount = await get('SELECT COUNT(*) AS count FROM users')
  if (Number(userCount.count) === 0) {
    await batch([
      {
        sql: 'INSERT INTO users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        args: ['u-admin', 'Admin', 'admin', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), 'admin'],
      },
      {
        sql: 'INSERT INTO users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        args: [
          'u-manager',
          'Manager',
          'manager',
          hashPassword(process.env.MANAGER_PASSWORD || 'manager123'),
          'manager',
        ],
      },
    ])
  }
}

export const ready = migrate().then(seedIfEmpty)

export async function listProducts() {
  return all('SELECT id, name, unit, rate FROM products ORDER BY name')
}

export async function saveProductRates(products) {
  await batch(
    products.map((product) => ({
      sql: 'UPDATE products SET rate = ? WHERE id = ?',
      args: [Number(product.rate), product.id],
    })),
  )
}

export async function addProduct({ name, unit, rate }) {
  const product = {
    id: crypto.randomUUID(),
    name: String(name ?? '').trim(),
    unit: String(unit ?? '').trim(),
    rate: Number(rate),
  }
  if (!product.name || !product.unit) throw new Error('Name and unit are required')
  if (!Number.isFinite(product.rate) || product.rate < 1) throw new Error('Rate must be at least 1')
  await exec('INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)', [
    product.id,
    product.name,
    product.unit,
    product.rate,
  ])
  return product
}

export async function deleteProduct(id) {
  await batch([
    { sql: 'DELETE FROM sale_lines WHERE product_id = ?', args: [id] },
    {
      sql: `UPDATE sales SET
         total = COALESCE((
           SELECT SUM(sl.amount) FROM sale_lines sl
           LEFT JOIN products p ON p.id = sl.product_id
           WHERE sl.sale_id = sales.id
             AND IFNULL(p.id, '') NOT IN ('loading', 'balance')
             AND IFNULL(lower(p.name), '') NOT IN ('loading', 'balance')
         ), 0),
         net = COALESCE((
           SELECT SUM(sl.amount) FROM sale_lines sl
           LEFT JOIN products p ON p.id = sl.product_id
           WHERE sl.sale_id = sales.id
             AND IFNULL(p.id, '') NOT IN ('loading', 'balance')
             AND IFNULL(lower(p.name), '') NOT IN ('loading', 'balance')
         ), 0) - expenses`,
      args: [],
    },
    { sql: 'DELETE FROM sales WHERE id NOT IN (SELECT DISTINCT sale_id FROM sale_lines)', args: [] },
    { sql: 'DELETE FROM products WHERE id = ?', args: [id] },
  ])
}

export async function listEmployees(month) {
  const value = String(month ?? '').trim()
  const monthFilter = /^\d{4}-\d{2}$/.test(value) ? 'AND substr(sx.date, 1, 7) = ?' : ''
  const saleJoin = /^\d{4}-\d{2}$/.test(value)
    ? 'LEFT JOIN sales s ON s.employee_id = e.id AND substr(s.date, 1, 7) = ?'
    : 'LEFT JOIN sales s ON s.employee_id = e.id'
  const args = /^\d{4}-\d{2}$/.test(value) ? [value, value] : []
  return all(
    `SELECT e.id, e.name, e.route,
            COALESCE(SUM(s.net), 0) AS totalEarned,
            COALESCE((
              SELECT SUM(sl.amount)
              FROM sale_lines sl
              JOIN sales sx ON sx.id = sl.sale_id
              LEFT JOIN products p ON p.id = sl.product_id
              WHERE sx.employee_id = e.id
                ${monthFilter}
                AND (IFNULL(p.id, '') = 'balance' OR IFNULL(lower(p.name), '') = 'balance')
            ), 0) AS balanceAmount
     FROM employees e
     ${saleJoin}
     GROUP BY e.id
     ORDER BY e.name`,
    args,
  )
}

export async function getEmployee(id) {
  return get('SELECT id, name, route FROM employees WHERE id = ?', [id])
}

export async function addEmployee({ name, route }) {
  const employee = {
    id: crypto.randomUUID(),
    name: String(name ?? '').trim(),
    route: String(route ?? '').trim(),
    totalEarned: 0,
  }
  if (!employee.name || !employee.route) {
    throw new Error('Name and route are required')
  }
  await exec('INSERT INTO employees (id, name, route) VALUES (?, ?, ?)', [employee.id, employee.name, employee.route])
  return employee
}

export async function deleteEmployee(id) {
  await batch([
    { sql: 'DELETE FROM route_credits WHERE target_employee_id = ? OR source_sale_id IN (SELECT id FROM sales WHERE employee_id = ?)', args: [id, id] },
    { sql: 'DELETE FROM sale_lines WHERE sale_id IN (SELECT id FROM sales WHERE employee_id = ?)', args: [id] },
    { sql: 'DELETE FROM sales WHERE employee_id = ?', args: [id] },
    { sql: 'DELETE FROM employees WHERE id = ?', args: [id] },
  ])
}

function parsePersonIds(value) {
  return [...new Set(String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean))]
}

function parseRouteTrips(value) {
  let raw = value
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try {
      raw = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  return raw.map((trip) => ({
    persons: Math.max(1, Math.round(Number(trip?.persons ?? trip?.personCount ?? 1) || 1)),
    ids: parsePersonIds(Array.isArray(trip?.ids) ? trip.ids.join(',') : trip?.ids),
  }))
}

async function attachLines(sales) {
  if (sales.length === 0) return []
  const placeholders = sales.map(() => '?').join(',')
  const lines = await all(
    `SELECT sale_id AS saleId, product_id AS productId, quantity, rate, amount
     FROM sale_lines WHERE sale_id IN (${placeholders})`,
    sales.map((sale) => sale.id),
  )
  const bySale = new Map(sales.map((sale) => [sale.id, []]))
  for (const line of lines) {
    bySale.get(line.saleId)?.push({
      productId: line.productId,
      quantity: line.quantity,
      rate: line.rate,
      amount: line.amount,
    })
  }
  const tripsBySale = new Map(sales.map((sale) => [sale.id, parseRouteTrips(sale.route_trips)]))
  const personIds = [
    ...new Set(
      sales.flatMap((sale) => [
        ...parsePersonIds(sale.route_person_id),
        ...(tripsBySale.get(sale.id) ?? []).flatMap((trip) => trip.ids),
      ]),
    ),
  ]
  const nameById = new Map()
  if (personIds.length > 0) {
    const rows = await all(
      `SELECT id, name FROM employees WHERE id IN (${personIds.map(() => '?').join(',')})`,
      personIds,
    )
    for (const row of rows) nameById.set(row.id, row.name)
  }

  const targetIds = [...new Set(sales.map((sale) => sale.employee_id))]
  const creditRows = await all(
    `SELECT rc.target_employee_id AS targetId, rc.date, rc.quantity, source.employee_id AS fromId, e.name AS fromName
     FROM route_credits rc
     JOIN sales source ON source.id = rc.source_sale_id
     JOIN employees e ON e.id = source.employee_id
     WHERE rc.target_employee_id IN (${targetIds.map(() => '?').join(',')})`,
    targetIds,
  )
  const creditsByKey = new Map()
  for (const row of creditRows) {
    const key = `${row.targetId}|${row.date}`
    if (!creditsByKey.has(key)) creditsByKey.set(key, [])
    creditsByKey.get(key).push({
      fromId: row.fromId,
      fromName: row.fromName || row.fromId,
      quantity: Number(row.quantity ?? 0),
    })
  }

  return sales.map((sale) => {
    const ids = parsePersonIds(sale.route_person_id)
    return {
      id: sale.id,
      employeeId: sale.employee_id,
      date: sale.date,
      total: sale.total,
      expenses: sale.expenses ?? 0,
      net: sale.net ?? sale.total - (sale.expenses ?? 0),
      attendance: sale.attendance || 'full',
      routePersonId: ids.join(','),
      routePersonName: ids.map((id) => nameById.get(id) || id).join(', '),
      routeCount: Number(sale.route_count ?? 0),
      routePersonCount: Number(sale.route_person_count ?? 1),
      routeTrips: (tripsBySale.get(sale.id) ?? []).map((trip) => ({
        persons: trip.persons,
        ids: trip.ids,
        names: trip.ids.map((id) => nameById.get(id) || id),
      })),
      routeCredits: creditsByKey.get(`${sale.employee_id}|${sale.date}`) ?? [],
      recordedBy: sale.recorded_by,
      recordedAt: sale.recorded_at,
      lines: bySale.get(sale.id) ?? [],
    }
  })
}

export async function listSales(employeeId) {
  const sales = employeeId
    ? await all(
        'SELECT * FROM sales WHERE employee_id = ? ORDER BY date DESC, recorded_at DESC',
        [employeeId],
      )
    : await all('SELECT * FROM sales ORDER BY date DESC, recorded_at DESC')
  return attachLines(sales)
}

function isRouteProduct(product) {
  return product.id === 'other-routes' || /route/i.test(product.unit || '') || /route/i.test(product.name || '')
}

function isLoadingProduct(product) {
  return product.id === 'loading' || String(product.name).toLowerCase() === 'loading'
}

function isBalanceProduct(product) {
  return product.id === 'balance' || String(product.name).toLowerCase() === 'balance'
}

function isAttendantProduct(product) {
  return product.id === 'attendants' || /attendant/i.test(product.name)
}

async function buildSaleRecord({
  id,
  employeeId,
  date,
  quantities,
  expenses,
  attendance,
  recordedBy,
  recordedAt,
  routePersonId,
  routePersonCount,
  routeTrips,
  splitRoutes = true,
}) {
  const employee = await getEmployee(employeeId)
  if (!employee) throw new Error('Employee not found')
  if (!date) throw new Error('Date is required')

  const existing = await get(
    id
      ? 'SELECT id FROM sales WHERE employee_id = ? AND date = ? AND id != ?'
      : 'SELECT id FROM sales WHERE employee_id = ? AND date = ?',
    id ? [employeeId, date, id] : [employeeId, date],
  )
  if (existing) {
    throw new Error('An entry is already added for this date. You cannot add another entry.')
  }

  const status = String(attendance ?? '').trim().toLowerCase() || 'full'
  if (!['full', 'half', 'absent'].includes(status)) {
    throw new Error('Attendance must be full, half, or absent')
  }

  const attendancePay = { absent: 0, half: 50, full: 100 }
  const attendanceQty = { absent: 0, half: 0.5, full: 1 }

  let products = await listProducts()
  if (!products.some((product) => isAttendantProduct(product))) {
    await exec('INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)', [
      'attendants',
      'Attendants',
      'person',
      100,
    ])
    products = await listProducts()
  }

  const personCount = Math.max(1, Math.round(Number(routePersonCount) || 1))
  const companionIds =
    personCount > 1 ? parsePersonIds(routePersonId).filter((id) => id !== employeeId) : []

  const trips = status === 'absent' ? [] : parseRouteTrips(routeTrips)
  const useTrips = splitRoutes && trips.length > 0

  // Shares credited by other employees live in route_credits, so a user-driven save
  // must add them back on top of this employee's own routes.
  const creditRouteProduct = products.find((product) => isRouteProduct(product))
  let creditedRouteQty = 0
  if (splitRoutes && creditRouteProduct && status !== 'absent') {
    const row = await get(
      'SELECT COALESCE(SUM(quantity), 0) AS qty FROM route_credits WHERE target_employee_id = ? AND date = ? AND product_id = ?',
      [employeeId, date, creditRouteProduct.id],
    )
    creditedRouteQty = Number(row?.qty ?? 0)
  }
  const tripShares = new Map()
  let ownRouteQty = 0
  if (useTrips) {
    trips.forEach((trip, index) => {
      const companions = trip.ids.filter((id) => id !== employeeId)
      if (companions.length !== trip.persons - 1) {
        throw new Error(`Select ${trip.persons - 1} person(s) who went on route ${index + 1}`)
      }
      const share = 1 / trip.persons
      ownRouteQty += share
      for (const id of companions) tripShares.set(id, (tripShares.get(id) ?? 0) + share)
    })
  }

  const existingLines = id
    ? await all('SELECT product_id AS productId, quantity FROM sale_lines WHERE sale_id = ?', [id])
    : []

  const lines = products.map((product) => {
    if (isAttendantProduct(product)) {
      return {
        productId: product.id,
        quantity: attendanceQty[status],
        rate: attendancePay[status],
        amount: attendancePay[status],
      }
    }
    let quantity = status === 'absent' ? 0 : Number(quantities?.[product.id] ?? 0)
    if (isBalanceProduct(product) && (!quantities || !Object.prototype.hasOwnProperty.call(quantities, product.id))) {
      const previous = existingLines.find((line) => line.productId === product.id)
      quantity = Number(previous?.quantity ?? 0)
    }
    if (Number.isNaN(quantity) || quantity < 0) {
      throw new Error(`Invalid quantity for ${product.name}`)
    }
    if (isRouteProduct(product)) {
      if (useTrips) {
        quantity = ownRouteQty
      } else if (splitRoutes && personCount > 1) {
        quantity = quantity / personCount
      }
      quantity += creditedRouteQty
    }
    const rate = isBalanceProduct(product) ? 1 : product.rate
    return {
      productId: product.id,
      quantity,
      rate,
      amount: quantity * rate,
    }
  })
  const productSales = lines.reduce((sum, line) => {
    const product = products.find((item) => item.id === line.productId)
    const item = product ?? { id: line.productId, name: '' }
    if (isLoadingProduct(item)) return sum
    if (isBalanceProduct(item)) return sum
    if (isAttendantProduct(item)) return sum
    return sum + line.amount
  }, 0)
  const total = productSales + attendancePay[status]
  const expenseTotal = Number(expenses ?? 0)
  if (Number.isNaN(expenseTotal) || expenseTotal < 0) throw new Error('Expenses cannot be negative')
  const net = total - expenseTotal

  const routeProduct = products.find((product) => isRouteProduct(product))
  const routeCount = useTrips
    ? trips.length
    : status === 'absent'
      ? 0
      : Number(quantities?.[routeProduct?.id] ?? 0)
  if (!useTrips && routeCount > 0 && personCount > 1 && companionIds.length !== personCount - 1) {
    throw new Error(`Select ${personCount - 1} person(s) who went on the other route`)
  }

  const storedTrips = splitRoutes
    ? trips.length
      ? JSON.stringify(trips)
      : null
    : typeof routeTrips === 'string'
      ? routeTrips || null
      : trips.length
        ? JSON.stringify(trips)
        : null

  return {
    id: id || crypto.randomUUID(),
    employeeId,
    date,
    lines,
    total,
    expenses: expenseTotal,
    net,
    attendance: status,
    routePersonId: useTrips ? [...tripShares.keys()].join(',') : companionIds.join(','),
    routeCount,
    routePersonCount: useTrips
      ? trips.reduce((max, trip) => Math.max(max, trip.persons), 1)
      : personCount,
    routeTrips: storedTrips,
    routeShares: useTrips
      ? [...tripShares.entries()].map(([targetEmployeeId, quantity]) => ({ targetEmployeeId, quantity }))
      : null,
    recordedBy,
    recordedAt: recordedAt || new Date().toISOString(),
  }
}

async function insertSaleRows(record) {
  await batch([
    {
      sql: 'INSERT INTO sales (id, employee_id, date, total, expenses, net, attendance, recorded_by, recorded_at, route_person_id, route_count, route_person_count, route_trips) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        record.id,
        record.employeeId,
        record.date,
        record.total,
        record.expenses,
        record.net,
        record.attendance,
        record.recordedBy,
        record.recordedAt,
        record.routePersonId || null,
        record.routeCount ?? 0,
        record.routePersonCount ?? 1,
        record.routeTrips ?? null,
      ],
    },
    ...record.lines.map((line) => ({
      sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)',
      args: [record.id, line.productId, line.quantity, line.rate, line.amount],
    })),
  ])
}

async function adjustEmployeeRouteQty(employeeId, date, productId, delta, recordedBy) {
  if (!delta) return
  const sale = await get('SELECT * FROM sales WHERE employee_id = ? AND date = ?', [employeeId, date])
  const products = await listProducts()
  if (!sale) {
    if (delta <= 0) return
    const quantities = Object.fromEntries(products.map((product) => [product.id, product.id === productId ? delta : 0]))
    const record = await buildSaleRecord({
      employeeId,
      date,
      quantities,
      expenses: 0,
      attendance: 'full',
      recordedBy: recordedBy || 'Route credit',
      splitRoutes: false,
    })
    await insertSaleRows(record)
    return
  }

  const lines = await all('SELECT product_id AS productId, quantity FROM sale_lines WHERE sale_id = ?', [sale.id])
  const quantities = Object.fromEntries(
    products.map((product) => {
      const line = lines.find((item) => item.productId === product.id)
      const current = Number(line?.quantity ?? 0)
      if (product.id === productId) return [product.id, Math.max(0, current + delta)]
      if (isAttendantProduct(product)) return [product.id, 0]
      return [product.id, current]
    }),
  )
  const record = await buildSaleRecord({
    id: sale.id,
    employeeId,
    date,
    quantities,
    expenses: sale.expenses,
    attendance: sale.attendance || 'full',
    recordedBy: sale.recorded_by,
    recordedAt: sale.recorded_at,
    routePersonId: sale.route_person_id,
    routePersonCount: sale.route_person_count || 1,
    routeTrips: sale.route_trips,
    splitRoutes: false,
  })
  await batch([
    { sql: 'DELETE FROM sale_lines WHERE sale_id = ?', args: [sale.id] },
    {
      sql: `UPDATE sales
       SET date = ?, total = ?, expenses = ?, net = ?, attendance = ?, recorded_by = ?, route_person_id = ?, route_count = ?, route_person_count = ?, route_trips = ?
       WHERE id = ?`,
      args: [
        record.date,
        record.total,
        record.expenses,
        record.net,
        record.attendance,
        record.recordedBy,
        sale.route_person_id || null,
        sale.route_count ?? 0,
        sale.route_person_count ?? 1,
        sale.route_trips ?? null,
        sale.id,
      ],
    },
    ...record.lines.map((line) => ({
      sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)',
      args: [sale.id, line.productId, line.quantity, line.rate, line.amount],
    })),
  ])
}

async function syncRouteCredit(record) {
  const products = await listProducts()
  const routeProduct = products.find((product) => isRouteProduct(product))
  if (!routeProduct) return

  const previous = await all('SELECT * FROM route_credits WHERE source_sale_id = ?', [record.id])
  for (const old of previous) {
    await adjustEmployeeRouteQty(old.target_employee_id, old.date, old.product_id, -old.quantity)
  }
  await exec('DELETE FROM route_credits WHERE source_sale_id = ?', [record.id])

  const quantity = record.lines.find((line) => line.productId === routeProduct.id)?.quantity ?? 0
  const shares =
    Array.isArray(record.routeShares) && record.routeShares.length > 0
      ? record.routeShares
      : parsePersonIds(record.routePersonId).map((targetEmployeeId) => ({ targetEmployeeId, quantity }))
  if (!shares.length || record.attendance === 'absent') return

  for (const { targetEmployeeId, quantity: share } of shares) {
    if (targetEmployeeId === record.employeeId || !(share > 0)) continue
    const target = await getEmployee(targetEmployeeId)
    if (!target) throw new Error('Person who went was not found')
    await adjustEmployeeRouteQty(targetEmployeeId, record.date, routeProduct.id, share, record.recordedBy)
    await exec(
      'INSERT INTO route_credits (source_sale_id, target_employee_id, date, product_id, quantity) VALUES (?, ?, ?, ?, ?)',
      [record.id, targetEmployeeId, record.date, routeProduct.id, share],
    )
  }
}

export async function recordSale(input) {
  const record = await buildSaleRecord(input)
  await insertSaleRows(record)
  if (!input.skipRouteSync) await syncRouteCredit(record)
  return record
}

export async function updateSale(id, input) {
  const current = await get('SELECT id, recorded_at FROM sales WHERE id = ?', [id])
  if (!current) throw new Error('Sale not found')
  const record = await buildSaleRecord({
    ...input,
    id,
    recordedAt: current.recorded_at,
  })

  await batch([
    { sql: 'DELETE FROM sale_lines WHERE sale_id = ?', args: [id] },
    {
      sql: `UPDATE sales
       SET date = ?, total = ?, expenses = ?, net = ?, attendance = ?, recorded_by = ?, route_person_id = ?, route_count = ?, route_person_count = ?, route_trips = ?
       WHERE id = ?`,
      args: [
        record.date,
        record.total,
        record.expenses,
        record.net,
        record.attendance,
        record.recordedBy,
        record.routePersonId || null,
        record.routeCount ?? 0,
        record.routePersonCount ?? 1,
        record.routeTrips ?? null,
        id,
      ],
    },
    ...record.lines.map((line) => ({
      sql: 'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)',
      args: [id, line.productId, line.quantity, line.rate, line.amount],
    })),
  ])
  if (!input.skipRouteSync) await syncRouteCredit(record)
  return record
}

export async function deleteSale(id) {
  const current = await get('SELECT * FROM sales WHERE id = ?', [id])
  if (current) {
    await syncRouteCredit({
      id,
      employeeId: current.employee_id,
      date: current.date,
      attendance: 'absent',
      lines: [],
      routePersonId: '',
    })
  }
  await batch([
    { sql: 'DELETE FROM route_credits WHERE source_sale_id = ?', args: [id] },
    { sql: 'DELETE FROM sale_lines WHERE sale_id = ?', args: [id] },
    { sql: 'DELETE FROM sales WHERE id = ?', args: [id] },
  ])
}

export async function getPermissionsForRole(role) {
  if (role === 'admin') return [...PERMISSION_KEYS]
  const row = await get('SELECT permissions FROM role_permissions WHERE role = ?', [role])
  return row ? parsePermissions(row.permissions) : DEFAULT_MANAGER_PERMISSIONS
}

export async function listRolePermissions() {
  const users = await all('SELECT DISTINCT role FROM users ORDER BY role')
  const stored = await all('SELECT role, permissions FROM role_permissions')
  const byRole = new Map(stored.map((row) => [row.role, parsePermissions(row.permissions)]))
  const roles = new Set(['admin', 'manager', ...users.map((row) => row.role)])
  return [...roles].map((role) => ({
    role,
    locked: role === 'admin',
    permissions: role === 'admin' ? [...PERMISSION_KEYS] : byRole.get(role) ?? DEFAULT_MANAGER_PERMISSIONS,
  }))
}

export async function saveRolePermissions(role, permissions) {
  const name = String(role ?? '').trim().toLowerCase()
  if (!name || name === 'admin') throw new Error('Admin access cannot be changed')
  const next = Array.isArray(permissions)
    ? permissions.filter((item) => PERMISSION_KEYS.includes(item))
    : []
  const existing = await get('SELECT role FROM role_permissions WHERE role = ?', [name])
  if (existing) {
    await exec('UPDATE role_permissions SET permissions = ? WHERE role = ?', [JSON.stringify(next), name])
  } else {
    await exec('INSERT INTO role_permissions (role, permissions) VALUES (?, ?)', [name, JSON.stringify(next)])
  }
  return listRolePermissions()
}

export async function getUserByToken(token) {
  const value = String(token ?? '').trim()
  if (!value) return null
  const session = await get('SELECT user_id FROM sessions WHERE token = ?', [value])
  if (!session) return null
  const user = await get('SELECT id, name, username, role FROM users WHERE id = ?', [session.user_id])
  if (!user) return null
  return publicUser(user, await getPermissionsForRole(user.role))
}

export async function getSessionUser(userId) {
  const user = await get('SELECT id, name, username, role FROM users WHERE id = ?', [userId])
  if (!user) return null
  return publicUser(user, await getPermissionsForRole(user.role))
}

export async function logoutUser(token) {
  const value = String(token ?? '').trim()
  if (!value) return
  await exec('DELETE FROM sessions WHERE token = ?', [value])
}

export async function loginUser({ username, password }) {
  const name = String(username ?? '').trim()
  const pass = String(password ?? '')
  if (!name || !pass) throw new Error('Username and password are required')

  const user = await get(
    'SELECT id, name, username, password_hash, role FROM users WHERE lower(username) = lower(?)',
    [name],
  )
  if (!user || !verifyPassword(pass, user.password_hash)) {
    const error = new Error('Invalid username or password')
    error.status = 401
    throw error
  }
  await exec('DELETE FROM sessions WHERE user_id = ?', [user.id])
  const token = randomBytes(32).toString('hex')
  await exec('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [
    token,
    user.id,
    new Date().toISOString(),
  ])
  return {
    ...publicUser(user, await getPermissionsForRole(user.role)),
    token,
  }
}
