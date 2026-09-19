import { FormEvent, useEffect, useState } from 'react'
import { addProduct, deleteProduct, listProducts, saveProductRates } from '../services/salesStore'
import { PageLoader } from '../components/PageLoader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { isBalanceProduct, isLoadingProduct } from '../productFlags'
import type { Product } from '../types'

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [addError, setAddError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [rate, setRate] = useState('1')

  async function refresh() {
    setProducts(await listProducts())
  }

  useEffect(() => {
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load products'))
      .finally(() => setLoading(false))
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await saveProductRates(products)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rates')
    } finally {
      setSaving(false)
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setAddError('')
    setAdding(true)
    try {
      await addProduct({ name, unit, rate: Number(rate) })
      setName('')
      setUnit('')
      setRate('1')
      setSaved(false)
      await refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add product')
    } finally {
      setAdding(false)
    }
  }

  async function onRemove(id: string) {
    setError('')
    setRemovingId(id)
    try {
      await deleteProduct(id)
      setConfirmId(null)
      setSaved(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove product')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <section className="stack">
      <section className="card">
        <h2>Product rates</h2>
        <p className="muted">
          Each sale amount is quantity × rate. Day expenses are entered on the sales sheet, not per
          product. Loading is ₹1 per unit and is kept out of overall sales and net earned. Balance is
          admin-only: enter an amount and it is subtracted once from that month’s net earned.
        </p>
        {loading ? (
          <PageLoader />
        ) : (
          <form onSubmit={onSubmit}>
            <table className="stack-mobile">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Unit</th>
                  <th>Rupees per unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, index) => (
                  <tr key={product.id}>
                    <td data-label="Product">
                      {product.name}
                      {isLoadingProduct(product) ? ' (not in overall total)' : ''}
                      {isBalanceProduct(product) ? ' (admin, subtracted once from the month)' : ''}
                    </td>
                    <td data-label="Unit">{product.unit}</td>
                    <td data-label="Rupees per unit">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={product.rate}
                        onChange={(e) => {
                          const nextRate = Number(e.target.value)
                          setSaved(false)
                          setProducts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, rate: nextRate } : item,
                            ),
                          )
                        }}
                      />
                    </td>
                    <td data-label="">
                      <button
                        type="button"
                        className="danger"
                        disabled={Boolean(removingId) || saving || adding}
                        onClick={() => setConfirmId(product.id)}
                      >
                        {removingId === product.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="submit" disabled={saving || adding || Boolean(removingId)}>
                {saving ? 'Saving…' : 'Save rates'}
              </button>
              {saved && <span className="muted">Saved. New sales will use these rates.</span>}
            </div>
          </form>
        )}
      </section>
      <section className="card">
        <h3>Add product</h3>
        <form className="form-grid" onSubmit={onAdd}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required disabled={adding} />
          </label>
          <label>
            Unit
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="case, pack, person"
              required
            />
          </label>
          <label>
            Rate
            <input
              type="number"
              min={1}
              step={1}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />
          </label>
          {addError && <p className="error full">{addError}</p>}
          <div className="actions full">
            <button type="submit" disabled={adding || saving}>
              {adding ? 'Adding…' : 'Add product'}
            </button>
          </div>
        </form>
      </section>
      {confirmId && (
        <ConfirmDialog
          title="Remove product?"
          message={`Remove ${products.find((item) => item.id === confirmId)?.name ?? 'this product'}? This cannot be undone.`}
          confirmLabel="Remove"
          busy={removingId === confirmId}
          onCancel={() => {
            if (!removingId) setConfirmId(null)
          }}
          onConfirm={() => onRemove(confirmId)}
        />
      )}
    </section>
  )
}
