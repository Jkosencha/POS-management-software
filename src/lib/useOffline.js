import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { getPendingSales, removePendingSale, countPendingSales } from './offlineStore'

export function useOffline() {
  const [isOnline, setIsOnline]       = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing]         = useState(false)
  const [syncErrors, setSyncErrors]   = useState([])

  const refreshCount = useCallback(async () => {
    const n = await countPendingSales().catch(() => 0)
    setPendingCount(n)
  }, [])

  const flushing = useRef(false)

  const flushQueue = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return  // one sync at a time
    flushing.current = true
    const pending = await getPendingSales().catch(() => [])
    if (!pending.length) { flushing.current = false; return }

    setSyncing(true)
    const errors = []

    for (const sale of pending) {
      try {
        const { error } = await supabase.rpc('checkout', {
          p_items:   sale.items,
          // client_id makes retries safe (no duplicates); created_at keeps
          // the time the sale was actually rung up
          p_payment: { ...sale.payment, client_id: sale.id, created_at: sale.created_at },
        })
        if (error) {
          errors.push({ id: sale.id, message: error.message })
        } else {
          await removePendingSale(sale.id)
        }
      } catch (e) {
        errors.push({ id: sale.id, message: e.message })
      }
    }

    setSyncing(false)
    setSyncErrors(errors)
    await refreshCount()
    flushing.current = false
  }, [refreshCount])

  useEffect(() => {
    // Sync anything left over from a previous session (the 'online' event
    // only fires on a change, not when the app opens already online)
    refreshCount()
    flushQueue()

    const goOnline  = () => { setIsOnline(true);  flushQueue() }
    const goOffline = () => setIsOnline(false)

    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [refreshCount, flushQueue])

  // Retry failed or leftover sales every minute while online
  useEffect(() => {
    const id = setInterval(() => { if (navigator.onLine) flushQueue() }, 60_000)
    return () => clearInterval(id)
  }, [flushQueue])

  // Permanently drop a queued sale (e.g. it can never sync because the item sold out)
  const discardPending = useCallback(async (id) => {
    await removePendingSale(id)
    setSyncErrors(prev => prev.filter(e => e.id !== id))
    await refreshCount()
  }, [refreshCount])

  return { isOnline, pendingCount, syncing, syncErrors, setSyncErrors, flushQueue, refreshCount, discardPending }
}
