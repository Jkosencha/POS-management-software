import { useState, useEffect, useCallback } from 'react'
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

  const flushQueue = useCallback(async () => {
    const pending = await getPendingSales().catch(() => [])
    if (!pending.length) return

    setSyncing(true)
    const errors = []

    for (const sale of pending) {
      try {
        const { error } = await supabase.rpc('checkout', {
          p_items:   sale.items,
          p_payment: sale.payment,
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
    if (errors.length) setSyncErrors(errors)
    await refreshCount()
  }, [refreshCount])

  useEffect(() => {
    refreshCount()

    const goOnline  = () => { setIsOnline(true);  flushQueue() }
    const goOffline = () => setIsOnline(false)

    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [refreshCount, flushQueue])

  return { isOnline, pendingCount, syncing, syncErrors, setSyncErrors, flushQueue, refreshCount }
}
