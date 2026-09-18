import type { Product, SaleRecord } from './types'

export function isAttendanceProduct(product?: Pick<Product, 'id' | 'name'> | null) {
  if (!product) return false
  return product.id === 'attendants' || /attendant/i.test(product.name)
}

export function isRouteProduct(product?: Pick<Product, 'id' | 'name' | 'unit'> | null) {
  if (!product) return false
  return product.id === 'other-routes' || /route/i.test(product.unit) || /route/i.test(product.name)
}

export function isLoadingProduct(product?: Pick<Product, 'id' | 'name'> | null, productId?: string) {
  if (productId === 'loading') return true
  if (!product) return false
  return product.id === 'loading' || /^loading$/i.test(product.name)
}

export function loadingAmount(sale: SaleRecord, products: Product[] = []) {
  return sale.lines.reduce((sum, line) => {
    const product = products.find((item) => item.id === line.productId)
    return isLoadingProduct(product, line.productId) ? sum + (line.amount ?? 0) : sum
  }, 0)
}
