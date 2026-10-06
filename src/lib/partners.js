import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// Stock with no owner (partner_id NULL) is shared, split evenly between partners
export const SHARED = { id: null, name: 'Shared', color: '#94a3b8' }

export const PARTNER_SWATCHES = ['#7c6cf0', '#e0559b', '#14a3a3', '#f59f00', '#3b82f6', '#22a06b', '#ef6c3c']

// Select values can't be null, so the Shared option uses this sentinel
export const SHARED_VALUE = 'shared'
export const toSelectValue = id => (id == null ? SHARED_VALUE : String(id))
export const fromSelectValue = v => (v === SHARED_VALUE ? null : Number(v))

export function usePartners() {
  const [partners, setPartners] = useState([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const { data } = await supabase.from('partners').select('*').order('id')
    setPartners(data || [])
    setLoaded(true)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const byId = id => (id == null ? SHARED : partners.find(p => p.id === id) || SHARED)

  return { partners, loaded, refresh, byId }
}
