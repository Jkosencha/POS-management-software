import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import ReceiptModal from '../register/ReceiptModal'
import VoidModal from './VoidModal'

export default function SalesHistory({ money, settings, role }) {
  const [sales, setSales]     = useState([])
  const [viewSale, setViewSale] = useState(null)
  const [voidSale, setVoidSale] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSales() {
      const { data } = await supabase
        .from('sales')
        .select('*, sale_items(*)')
        .order('created_at', { ascending: false })
        .limit(200)

      setSales((data || []).map(s => ({ ...s, items: s.sale_items || [] })))
      setLoading(false)
    }
    fetchSales()
  }, [])

  function handleVoided(saleId) {
    setSales(prev => prev.map(s =>
      s.id === saleId ? { ...s, status: 'voided' } : s
    ))
  }

  const canVoid = role === 'manager' || role === 'owner'

  if (loading) return <div className="page"><p style={{ color: 'var(--muted)' }}>Loading sales…</p></div>

  return (
    <div className="page">
      <header className="page-head"><h1>Sales</h1></header>

      {sales.length === 0 && (
        <div className="empty-grid">No sales yet — ring up your first customer on the Register.</div>
      )}

      <div className="table">
        {sales.length > 0 && (
          <div className="tr th">
            <span>Receipt</span>
            <span>Time</span>
            <span>Items</span>
            <span>Paid by</span>
            <span className="num">Total</span>
            <span />
          </div>
        )}

        {sales.map(s => {
          const voided = s.status === 'voided'
          return (
            <div
              className="tr"
              key={s.id}
              style={voided ? { opacity: .5 } : undefined}
            >
              <span className="mono" style={voided ? { textDecoration: 'line-through' } : undefined}>
                {s.receipt_no}
              </span>
              <span style={{ fontSize: 13 }}>
                {new Date(s.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>{(s.items || []).reduce((n, i) => n + i.qty, 0)} items</span>
              <span>
                {s.method}
                {voided && (
                  <span className="badge badge-red" style={{ marginLeft: 6 }}>VOID</span>
                )}
              </span>
              <span className="num">{money(s.total)}</span>
              <span className="row-act" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="link" onClick={() => setViewSale(s)}>Receipt</button>
                {canVoid && !voided && (
                  <button
                    className="link"
                    style={{ color: 'var(--red)' }}
                    onClick={() => setVoidSale(s)}
                  >
                    Void
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {viewSale && (
        <ReceiptModal
          sale={viewSale}
          settings={settings}
          money={money}
          onClose={() => setViewSale(null)}
        />
      )}

      {voidSale && (
        <VoidModal
          sale={voidSale}
          money={money}
          onClose={() => setVoidSale(null)}
          onVoided={handleVoided}
        />
      )}
    </div>
  )
}
