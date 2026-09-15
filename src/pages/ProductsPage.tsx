import { FormEvent, useEffect, useState } from 'react'
import { addProduct, deleteProduct, listProducts, saveProductRates } from '../services/salesStore'
import type { Product } from '../types'

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [addError, setAddError] = useState('')
  const [loading, setLoading] = useState(true)
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
    try {
      await saveProductRates(products)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rates')
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setAddError('')
    try {
      await addProduct({ name, unit, rate: Number(rate) })
      setName('')
      setUnit('')
      setRate('1')
      setSaved(false)
      await refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add product')
    }
  }

  return (
    <section className="stack">
      <section className="card">
        <h2>Product rates</h2>
        <p className="muted">Each sale amount is quantity × rate. Day expenses are entered on the sales sheet, not per product.</p>
        {loading ? (
          <p className="muted">Loading…</p>
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
                    <td data-label="Product">{product.name}</td>
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
                        onClick={async () => {
                          setError('')
                          try {
                            await deleteProduct(product.id)
                            setSaved(false)
                            await refresh()
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Could not remove product')
                          }
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="submit">Save rates</button>
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
            <input value={name} onChange={(e) => setName(e.target.value)} required />
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
            <button type="submit">Add product</button>
          </div>
        </form>
      </section>
    </section>
  )
}
