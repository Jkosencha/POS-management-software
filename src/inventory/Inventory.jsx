import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Search, TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useBarcode } from '../lib/useBarcode'
import { usePartners } from '../lib/partners'
import { PartnerBadge } from '../components/PartnerBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import ProductModal from './ProductModal'
import RestockModal from './RestockModal'
import StockHistoryModal from './StockHistoryModal'

const EMPTY_PRODUCT = { name: '', sku: '', barcode: '', category: '', price: '', stock: 0, low_at: 5 }

// canManage = manager/owner. Cashiers get a read-only stock list: RLS doesn't
// let them change products or stock, and owner/cost details stay hidden.
export default function Inventory({ money, canManage = true, openAdd, onIntentHandled, onStockChanged }) {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([]) // [{ name, active }]
  const [owners, setOwners] = useState({})          // product_id -> { partnerKey: units }
  const { partners, byId } = usePartners()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('active') // 'active' | 'low' | 'inactive' | 'all'
  const [editProduct, setEditProduct] = useState(null)
  const [restockProduct, setRestockProduct] = useState(null)
  const [historyProduct, setHistoryProduct] = useState(null)
  const [toast, setToast] = useState(null)

  const fetchProducts = useCallback(async () => {
    const [{ data }, { data: cats, error: catErr }, { data: batches }] = await Promise.all([
      fetchAll(() => supabase.from('products').select('*').order('category').order('name').order('id')),
      supabase.from('categories').select('name, active').order('name'),
      // Stock on hand per owner (empty before migration 010)
      fetchAll(() => supabase.from('stock_batches').select('product_id, partner_id, qty_remaining').gt('qty_remaining', 0).order('id')),
    ])
    const byProduct = {}
    ;(batches || []).forEach(b => {
      const own = (byProduct[b.product_id] ||= {})
      const key = b.partner_id ?? 'shared'
      own[key] = (own[key] || 0) + b.qty_remaining
    })
    setOwners(byProduct)
    const list = data || []
    setProducts(list)
    // Before migration 009 there is no categories table: fall back to the
    // categories products already use
    setCategories(catErr
      ? Array.from(new Set(list.map(p => p.category))).map(name => ({ name, active: true }))
      : cats || [])
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  // "Add product" quick action from the sidebar
  useEffect(() => {
    if (!openAdd) return
    setEditProduct({ ...EMPTY_PRODUCT })
    onIntentHandled?.()
  }, [openAdd, onIntentHandled])

  const flash = msg => { setToast(msg); setTimeout(() => setToast(null), 2800) }

  const refresh = () => { fetchProducts(); onStockChanged?.() }

  /* ---- barcode scanner: scan → open restock form (cashiers: search) ---- */
  const handleScan = useCallback((code) => {
    if (!canManage) { setQ(code); return }
    const product = products.find(p =>
      (p.barcode && p.barcode === code) || (p.sku && p.sku === code)
    )
    if (product) {
      setRestockProduct(product)
    } else {
      flash(`Code "${code}" not found. Add it as a new product.`)
      setEditProduct({ ...EMPTY_PRODUCT, barcode: code })
    }
  }, [products, canManage])

  // Pause scanner while any modal is open
  useBarcode(handleScan, !editProduct && !restockProduct && !historyProduct)

  const handleSave = async (data) => {
    const row = {
      name: data.name,
      sku: data.sku || null,
      barcode: data.barcode || null,
      category: data.category,
      price: data.price,
      cost_price: data.cost_price,
      supplier: data.supplier,
      low_at: data.low_at,
    }

    if (data.id) {
      // Stock isn't edited here: it changes through Restock so every unit has an owner
      const { error } = await supabase.from('products').update(row).eq('id', data.id)
      if (error) return flash(error.message)
      flash('Product updated')
    } else {
      const { data: created, error } = await supabase
        .from('products').insert({ ...row, stock: 0 }).select('id').single()
      if (error) return flash(error.message)

      // Opening stock goes in as a restock, which creates the owner's batch
      if (data.stock > 0) {
        const { error: movErr } = await supabase.from('stock_movements').insert({
          product_id: created.id,
          qty_change: data.stock,
          reason: 'restock',
          note: 'Opening stock',
          unit_cost: data.cost_price,
          ...(data.partner_id != null ? { partner_id: data.partner_id } : {}),
        })
        if (movErr) return flash(`Product added, but stock failed: ${movErr.message}`)
      }
      flash('Product added')
    }
    setEditProduct(null)
    refresh()
  }

  const handleSetActive = async (id, active) => {
    const { error } = await supabase.from('products').update({ active }).eq('id', id)
    if (error) return flash(error.message)
    flash(active ? 'Product reactivated' : 'Product deactivated. Find it under Inactive to bring it back.')
    setEditProduct(null)
    refresh()
  }

  const isLow = p => p.active && p.stock <= p.low_at
  const inactiveCount = products.filter(p => !p.active).length
  const lowStockCount = products.filter(isLow).length

  const list = products.filter(p => {
    const needle = q.toLowerCase()
    const matchQ = !q || p.name.toLowerCase().includes(needle) || (p.sku || '').toLowerCase().includes(needle)
    if (filter === 'active') return matchQ && p.active
    if (filter === 'low')    return matchQ && isLow(p)
    if (filter === 'inactive') return matchQ && !p.active
    return matchQ // 'all': show inactive too
  })

  return (
    <div className="page">
      <header className="page-head">
        <h1>Inventory</h1>
        {canManage && (
          <Button onClick={() => setEditProduct({ ...EMPTY_PRODUCT })}>
            <Plus /> Add product
          </Button>
        )}
      </header>

      <div className="flex flex-wrap gap-2.5 items-center mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <Input
            className="pl-10 rounded-full h-10"
            placeholder="Search by name or SKU..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className={`cat ${filter === 'active' ? 'on' : ''}`} onClick={() => setFilter('active')}>Active</button>
          <button className={`cat ${filter === 'low' ? 'on' : ''}`} onClick={() => setFilter('low')}>
            Low stock {lowStockCount > 0 && `(${lowStockCount})`}
          </button>
          {canManage && inactiveCount > 0 && (
            <button className={`cat ${filter === 'inactive' ? 'on' : ''}`} onClick={() => setFilter('inactive')}>
              Inactive ({inactiveCount})
            </button>
          )}
          {canManage && <button className={`cat ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>}
        </div>
      </div>

      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Product</TableHead>
              <TableHead className="max-md:hidden">SKU</TableHead>
              <TableHead className="max-md:hidden">Category</TableHead>
              <TableHead className="text-right">Selling price</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              {canManage && <TableHead className="max-lg:hidden">Owners</TableHead>}
              {canManage && <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map(p => {
              const low = isLow(p)
              return (
                <TableRow
                  key={p.id}
                  className={`${p.active && p.stock === 0 ? 'bg-red-tint/50' : low ? 'bg-amber-tint/40' : ''}`}
                >
                  <TableCell className={`font-semibold ${!p.active ? 'text-muted' : low ? 'text-red' : 'text-ink'}`}>
                    {p.name}
                    {!p.active && <span className="ml-2 text-xs font-medium text-muted">(inactive)</span>}
                  </TableCell>
                  <TableCell className="mono text-ink-2 max-md:hidden">{p.sku}</TableCell>
                  <TableCell className="text-ink-2 max-md:hidden">{p.category}</TableCell>
                  <TableCell className="num">{money(p.price)}</TableCell>
                  <TableCell className={`num ${low ? 'text-red font-bold' : ''}`}>
                    <span className="inline-flex items-center gap-1">
                      {low && <TriangleAlert size={13} />}{p.stock}
                    </span>
                  </TableCell>
                  {canManage && <TableCell className="max-lg:hidden">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(owners[p.id] || {}).map(([key, units]) => (
                        <PartnerBadge key={key} partner={byId(key === 'shared' ? null : Number(key))}>{units}</PartnerBadge>
                      ))}
                    </div>
                  </TableCell>}
                  {canManage && <TableCell>
                    <div className="flex gap-1 justify-end">
                      {p.active ? (
                        <Button size="sm" variant="ghost" className="text-green hover:text-green" onClick={() => setRestockProduct(p)}>
                          Restock
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-green hover:text-green" onClick={() => handleSetActive(p.id, true)}>
                          Reactivate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setHistoryProduct(p)}>History</Button>
                      <Button size="sm" variant="ghost" className="text-accent hover:text-accent" onClick={() => setEditProduct(p)}>Edit</Button>
                    </div>
                  </TableCell>}
                </TableRow>
              )
            })}
            {list.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={canManage ? 7 : 5} className="empty-grid">
                  {filter === 'low' ? 'No low-stock items. All stocked up.'
                    : filter === 'inactive' ? 'No inactive products.' : 'Nothing here yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {editProduct && (
        <ProductModal
          product={editProduct}
          categories={categories}
          partners={partners}
          onSave={handleSave}
          onSetActive={handleSetActive}
          onOwnersChanged={fetchProducts}
          onClose={() => setEditProduct(null)}
        />
      )}
      {restockProduct && (
        <RestockModal
          product={restockProduct}
          partners={partners}
          onClose={() => setRestockProduct(null)}
          onDone={() => {
            setRestockProduct(null)
            flash(`${restockProduct.name} updated`)
            refresh()
          }}
        />
      )}
      {historyProduct && (
        <StockHistoryModal
          product={historyProduct}
          partners={partners}
          onChanged={refresh}
          onClose={() => setHistoryProduct(null)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
