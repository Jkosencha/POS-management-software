import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'
import ReasonBadge from '../components/ReasonBadge'
import { PartnerBadge } from '../components/PartnerBadge'
import BatchOwners from './BatchOwners'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function StockHistoryModal({ product, partners = [], onClose, onChanged }) {
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('stock_movements')
      .select('*, profiles(full_name), partners(name, color)')
      .eq('product_id', product.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(async ({ data, error }) => {
        // Before migration 010 there's no partners relation to embed
        if (error) {
          ({ data } = await supabase.from('stock_movements').select('*, profiles(full_name)')
            .eq('product_id', product.id).order('created_at', { ascending: false }).limit(50))
        }
        setMovements(data || [])
        setLoading(false)
      })
  }, [product.id])

  // Walk backwards from the current stock to get the balance after each movement
  const runningStock = []
  let running = product.stock
  for (const m of movements) {
    runningStock.push(running)
    running -= m.qty_change
  }

  return (
    <Modal title={`Stock history: ${product.name}`} onClose={onClose} className="max-w-[640px]">
      <div className="flex justify-between items-center mb-3 rounded-sm bg-surface-2 px-4 py-3">
        <span className="text-[13px] text-muted">Current stock</span>
        <span className="text-xl font-bold font-mono">{product.stock}</span>
      </div>

      <div className="mb-4">
        <BatchOwners productId={product.id} partners={partners} onChanged={onChanged} />
      </div>

      {loading && <p className="text-muted text-[13px]">Loading...</p>}

      {!loading && movements.length === 0 && (
        <p className="text-muted text-[13px]">No movements recorded yet.</p>
      )}

      {!loading && movements.length > 0 && (
        <div className="max-h-[400px] overflow-y-auto rounded-sm border border-line">
          <Table>
            <TableHeader className="sticky top-0 bg-surface z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m, i) => (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-normal">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <ReasonBadge reason={m.reason} />
                      {m.partners && <PartnerBadge partner={m.partners} />}
                    </span>
                    {m.note && <div className="mt-1 text-xs text-ink-2">{m.note}</div>}
                    <div className="mt-0.5 text-[11px] text-muted">
                      {new Date(m.created_at).toLocaleString('en-KE')}
                      {m.profiles?.full_name ? ` · ${m.profiles.full_name}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className={`num font-bold ${m.qty_change > 0 ? 'text-green' : 'text-red'}`}>
                    {m.qty_change > 0 ? '+' : ''}{m.qty_change}
                  </TableCell>
                  <TableCell className="num text-muted">{runningStock[i]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Modal>
  )
}
