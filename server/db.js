import { mkdirSync } from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR || join(root, '..', 'data')
const dbPath = join(dataDir, 'sales.db')

mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 5000')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    rate REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    route TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,
    total REAL NOT NULL,
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );
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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL
  );
`)

function columns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
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

function migrate() {
  if (columns('employees').includes('email')) {
    db.exec('ALTER TABLE employees DROP COLUMN email')
  }

  const userCols = columns('users')
  if (userCols.includes('email') || !userCols.includes('username') || !userCols.includes('password_hash')) {
    const existing = db.prepare('SELECT * FROM users').all()
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL
      );
    `)
    const insert = db.prepare(
      'INSERT INTO users_new (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    )
    for (const user of existing) {
      const username =
        user.username ||
        (user.role === 'admin' ? 'admin' : user.role === 'manager' ? 'manager' : String(user.name).toLowerCase())
      const passwordHash = user.password_hash || hashPassword(username === 'admin' ? 'admin123' : 'manager123')
      insert.run(user.id, user.name, username, passwordHash, user.role)
    }
    db.exec('DROP TABLE users')
    db.exec('ALTER TABLE users_new RENAME TO users')
  }

  if (!columns('products').includes('expense')) {
    db.exec('ALTER TABLE products ADD COLUMN expense REAL NOT NULL DEFAULT 0')
  }
  if (!columns('sale_lines').includes('expense')) {
    db.exec('ALTER TABLE sale_lines ADD COLUMN expense REAL NOT NULL DEFAULT 0')
  }
  if (!columns('sale_lines').includes('expense_amount')) {
    db.exec('ALTER TABLE sale_lines ADD COLUMN expense_amount REAL NOT NULL DEFAULT 0')
  }
  if (!columns('sales').includes('expenses')) {
    db.exec('ALTER TABLE sales ADD COLUMN expenses REAL NOT NULL DEFAULT 0')
  }
  if (!columns('sales').includes('net')) {
    db.exec('ALTER TABLE sales ADD COLUMN net REAL NOT NULL DEFAULT 0')
  }
  if (!columns('sales').includes('attendance')) {
    db.exec("ALTER TABLE sales ADD COLUMN attendance TEXT NOT NULL DEFAULT 'full'")
  }
  db.exec('UPDATE sales SET net = total - expenses')
}

migrate()

function seedIfEmpty() {
  const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get()
  if (Number(productCount.count) === 0) {
    const insertProduct = db.prepare('INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)')
    const products = [
      ['water', 'Water', 'case', 5],
      ['glass', 'Glass', 'case', 8],
      ['ppt', 'PPT', 'pack', 12],
      ['other-routes', 'Other routes', 'route', 15],
      ['attendants', 'Attendants', 'person', 20],
    ]
    for (const row of products) insertProduct.run(...row)

    const insertEmployee = db.prepare('INSERT INTO employees (id, name, route) VALUES (?, ?, ?)')
    insertEmployee.run('e-ana', 'Ana', 'City route')
    insertEmployee.run('e-ravi', 'Ravi', 'North route')
    insertEmployee.run('e-meena', 'Meena', 'South route')

    const saleId = 's1'
    const today = new Date().toISOString().slice(0, 10)
    db.prepare(
      'INSERT INTO sales (id, employee_id, date, total, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(saleId, 'e-ana', today, 181, 'Admin', new Date().toISOString())

    const insertLine = db.prepare(
      'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)',
    )
    insertLine.run(saleId, 'water', 10, 5, 50)
    insertLine.run(saleId, 'glass', 4, 8, 32)
    insertLine.run(saleId, 'ppt', 2, 12, 24)
    insertLine.run(saleId, 'other-routes', 1, 15, 15)
    insertLine.run(saleId, 'attendants', 3, 20, 60)
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get()
  if (Number(userCount.count) === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    )
    insertUser.run('u-admin', 'Admin', 'admin', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), 'admin')
    insertUser.run(
      'u-manager',
      'Manager',
      'manager',
      hashPassword(process.env.MANAGER_PASSWORD || 'manager123'),
      'manager',
    )
  }
}

seedIfEmpty()
db.exec('UPDATE sales SET net = total - expenses')

export function listProducts() {
  return db.prepare('SELECT id, name, unit, rate FROM products ORDER BY name').all()
}

export function saveProductRates(products) {
  const update = db.prepare('UPDATE products SET rate = ? WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const product of products) {
      update.run(Number(product.rate), product.id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function addProduct({ name, unit, rate }) {
  const product = {
    id: crypto.randomUUID(),
    name: String(name ?? '').trim(),
    unit: String(unit ?? '').trim(),
    rate: Number(rate),
  }
  if (!product.name || !product.unit) throw new Error('Name and unit are required')
  if (!Number.isFinite(product.rate) || product.rate < 1) throw new Error('Rate must be at least 1')
  db.prepare('INSERT INTO products (id, name, unit, rate) VALUES (?, ?, ?, ?)').run(
    product.id,
    product.name,
    product.unit,
    product.rate,
  )
  return product
}

export function deleteProduct(id) {
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM sale_lines WHERE product_id = ?').run(id)
    db.prepare(
      `UPDATE sales SET
         total = COALESCE((SELECT SUM(amount) FROM sale_lines WHERE sale_id = sales.id), 0),
         net = COALESCE((SELECT SUM(amount) FROM sale_lines WHERE sale_id = sales.id), 0) - expenses`,
    ).run()
    db.prepare(
      'DELETE FROM sales WHERE id NOT IN (SELECT DISTINCT sale_id FROM sale_lines)',
    ).run()
    db.prepare('DELETE FROM products WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function listEmployees() {
  return db
    .prepare(
      `SELECT e.id, e.name, e.route,
              COALESCE(SUM(s.net), 0) AS totalEarned
       FROM employees e
       LEFT JOIN sales s ON s.employee_id = e.id
       GROUP BY e.id
       ORDER BY e.name`,
    )
    .all()
}

export function getEmployee(id) {
  return db.prepare('SELECT id, name, route FROM employees WHERE id = ?').get(id)
}

export function addEmployee({ name, route }) {
  const employee = {
    id: crypto.randomUUID(),
    name: String(name ?? '').trim(),
    route: String(route ?? '').trim(),
    totalEarned: 0,
  }
  if (!employee.name || !employee.route) {
    throw new Error('Name and route are required')
  }
  db.prepare('INSERT INTO employees (id, name, route) VALUES (?, ?, ?)').run(
    employee.id,
    employee.name,
    employee.route,
  )
  return employee
}

export function deleteEmployee(id) {
  db.exec('BEGIN')
  try {
    db.prepare(
      'DELETE FROM sale_lines WHERE sale_id IN (SELECT id FROM sales WHERE employee_id = ?)',
    ).run(id)
    db.prepare('DELETE FROM sales WHERE employee_id = ?').run(id)
    db.prepare('DELETE FROM employees WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function attachLines(sales) {
  if (sales.length === 0) return []
  const placeholders = sales.map(() => '?').join(',')
  const lines = db
    .prepare(
      `SELECT sale_id AS saleId, product_id AS productId, quantity, rate, amount
       FROM sale_lines WHERE sale_id IN (${placeholders})`,
    )
    .all(...sales.map((sale) => sale.id))
  const bySale = new Map(sales.map((sale) => [sale.id, []]))
  for (const line of lines) {
    bySale.get(line.saleId)?.push({
      productId: line.productId,
      quantity: line.quantity,
      rate: line.rate,
      amount: line.amount,
    })
  }
  return sales.map((sale) => ({
    id: sale.id,
    employeeId: sale.employee_id,
    date: sale.date,
    total: sale.total,
    expenses: sale.expenses ?? 0,
    net: sale.net ?? (sale.total - (sale.expenses ?? 0)),
    attendance: sale.attendance || 'full',
    recordedBy: sale.recorded_by,
    recordedAt: sale.recorded_at,
    lines: bySale.get(sale.id) ?? [],
  }))
}

export function listSales(employeeId) {
  const sales = employeeId
    ? db
        .prepare(
          `SELECT * FROM sales WHERE employee_id = ?
           ORDER BY date DESC, recorded_at DESC`,
        )
        .all(employeeId)
    : db.prepare('SELECT * FROM sales ORDER BY date DESC, recorded_at DESC').all()
  return attachLines(sales)
}

function buildSaleRecord({ id, employeeId, date, quantities, expenses, attendance, recordedBy, recordedAt }) {
  const employee = getEmployee(employeeId)
  if (!employee) throw new Error('Employee not found')
  if (!date) throw new Error('Date is required')

  const existing = db
    .prepare(
      id
        ? 'SELECT id FROM sales WHERE employee_id = ? AND date = ? AND id != ?'
        : 'SELECT id FROM sales WHERE employee_id = ? AND date = ?',
    )
    .get(...(id ? [employeeId, date, id] : [employeeId, date]))
  if (existing) {
    throw new Error('An entry is already added for this date. You cannot add another entry.')
  }

  const status = String(attendance ?? '').trim().toLowerCase() || 'full'
  if (!['full', 'half', 'absent'].includes(status)) {
    throw new Error('Attendance must be full, half, or absent')
  }

  const attendancePay = { absent: 0, half: 50, full: 100 }
  const attendanceQty = { absent: 0, half: 0.5, full: 1 }

  const products = listProducts()
  const lines = products.map((product) => {
    const isAttendant = product.id === 'attendants' || /attendant/i.test(product.name)
    if (isAttendant) {
      return {
        productId: product.id,
        quantity: attendanceQty[status],
        rate: attendancePay[status],
        amount: attendancePay[status],
      }
    }
    const quantity = status === 'absent' ? 0 : Number(quantities?.[product.id] ?? 0)
    if (Number.isNaN(quantity) || quantity < 0) {
      throw new Error(`Invalid quantity for ${product.name}`)
    }
    return {
      productId: product.id,
      quantity,
      rate: product.rate,
      amount: quantity * product.rate,
    }
  })
  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  const expenseTotal = Number(expenses ?? 0)
  if (Number.isNaN(expenseTotal) || expenseTotal < 0) throw new Error('Expenses cannot be negative')
  if (status !== 'absent' && total <= 0) {
    throw new Error('Enter at least one sold quantity')
  }
  const net = total - expenseTotal

  return {
    id: id || crypto.randomUUID(),
    employeeId,
    date,
    lines,
    total,
    expenses: expenseTotal,
    net,
    attendance: status,
    recordedBy,
    recordedAt: recordedAt || new Date().toISOString(),
  }
}

export function recordSale(input) {
  const record = buildSaleRecord(input)

  db.exec('BEGIN')
  try {
    db.prepare(
      'INSERT INTO sales (id, employee_id, date, total, expenses, net, attendance, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      record.id,
      record.employeeId,
      record.date,
      record.total,
      record.expenses,
      record.net,
      record.attendance,
      record.recordedBy,
      record.recordedAt,
    )
    const insertLine = db.prepare(
      'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)',
    )
    for (const line of record.lines) {
      insertLine.run(record.id, line.productId, line.quantity, line.rate, line.amount)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return record
}

export function updateSale(id, input) {
  const current = db.prepare('SELECT id, recorded_at FROM sales WHERE id = ?').get(id)
  if (!current) throw new Error('Sale not found')
  const record = buildSaleRecord({
    ...input,
    id,
    recordedAt: current.recorded_at,
  })

  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM sale_lines WHERE sale_id = ?').run(id)
    db.prepare(
      `UPDATE sales
       SET date = ?, total = ?, expenses = ?, net = ?, attendance = ?, recorded_by = ?
       WHERE id = ?`,
    ).run(
      record.date,
      record.total,
      record.expenses,
      record.net,
      record.attendance,
      record.recordedBy,
      id,
    )
    const insertLine = db.prepare(
      'INSERT INTO sale_lines (sale_id, product_id, quantity, rate, amount) VALUES (?, ?, ?, ?, ?)',
    )
    for (const line of record.lines) {
      insertLine.run(id, line.productId, line.quantity, line.rate, line.amount)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return record
}

export function deleteSale(id) {
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM sale_lines WHERE sale_id = ?').run(id)
    db.prepare('DELETE FROM sales WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function loginUser({ username, password }) {
  const name = String(username ?? '').trim()
  const pass = String(password ?? '')
  if (!name || !pass) throw new Error('Username and password are required')

  const user = db
    .prepare('SELECT id, name, username, password_hash, role FROM users WHERE lower(username) = lower(?)')
    .get(name)
  if (!user || !verifyPassword(pass, user.password_hash)) {
    const error = new Error('Invalid username or password')
    error.status = 401
    throw error
  }
  return { id: user.id, name: user.name, username: user.username, role: user.role }
}
