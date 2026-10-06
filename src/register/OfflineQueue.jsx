import React, { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { getPendingSales } from '../lib/offlineStore'
import Modal from '../components/Modal'
import PasswordConfirmDialog from '../components/PasswordConfirmDialog'
import { Button } from '@/components/ui/button'

/*
 * Sales rung up while offline that haven't reached the server yet, with the
 * reason any of them failed. Anyone can retry; only managers/owners can
 * discard one (e.g. it can never go through because the item sold out).
 */
export default function OfflineQueue({ money, isOnline, syncing, syncErrors, canDiscard, onRetry, onDiscard, onClose }) {
  const [sales, setSales]       = useState([])
  const [discarding, setDiscarding] = useState(null)

  const load = useCallback(() => getPendingSales().then(setSales).catch(() => setSales([])), [])
  useEffect(() => { load() }, [load, syncing, syncErrors])

  const errorFor = id => syncErrors.find(e => e.id === id)?.message

  return (
    <Modal
      title="Offline sales"
      description="Sales rung up without internet. They sync automatically when the connection is back."
      onClose={onClose}
      className="max-w-[560px]"
    >
      {sales.length === 0 ? (
        <p className="text-sm text-green font-semibold my-2">Everything has synced. Nothing is waiting.</p>
      ) : (
        <div className="rounded-sm border border-line divide-y divide-line mb-4 max-h-[50vh] overflow-y-auto">
          {sales.map(s => {
            const err = errorFor(s.id)
            const lines = s.summary?.lines || s.items.map(i => ({ name: `Product #${i.product_id}`, qty: i.qty }))
            return (
              <div key={s.id} className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">
                      {new Date(s.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{s.payment?.method}
                    </div>
                    <div className="text-xs text-ink-2 mt-0.5">
                      {lines.map(l => `${l.qty} × ${l.name}`).join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.summary?.total != null && <span className="font-mono font-bold text-sm">{money(s.summary.total)}</span>}
                    {canDiscard && (
                      <Button size="icon-sm" variant="ghost" className="text-red hover:text-red hover:bg-red-tint" onClick={() => setDiscarding(s)} aria-label="Discard sale">
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>
                <div className={`text-xs mt-1.5 ${err ? 'text-red' : 'text-muted'}`}>
                  {err ? `Couldn't sync: ${err}` : 'Waiting to sync'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {sales.length > 0 && !canDiscard && syncErrors.length > 0 && (
        <p className="text-xs text-muted mt-0 mb-3">Ask a manager or the owner to review sales that keep failing.</p>
      )}

      <div className="flex gap-2.5">
        <Button variant="outline" className="flex-1" onClick={onClose}>Close</Button>
        {sales.length > 0 && (
          <Button className="flex-1" onClick={onRetry} disabled={!isOnline || syncing}>
            <RefreshCw className={syncing ? 'animate-spin' : ''} />
            {!isOnline ? 'Waiting for internet' : syncing ? 'Syncing...' : 'Sync now'}
          </Button>
        )}
      </div>

      <PasswordConfirmDialog
        open={Boolean(discarding)}
        onOpenChange={open => { if (!open) setDiscarding(null) }}
        title="Discard this offline sale?"
        description="It will never be recorded: it won't appear in sales, reports or stock. Only do this if the sale didn't really happen or was rung up again."
        confirmLabel="Discard sale"
        onConfirm={async () => { await onDiscard(discarding.id); load() }}
      />
    </Modal>
  )
}
