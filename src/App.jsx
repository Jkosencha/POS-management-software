import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from './auth/useSession'
import { supabase } from './lib/supabase'
import { formatMoney } from './lib/money'
import { useOffline } from './lib/useOffline'
import { useTheme } from './lib/useTheme'
import Login from './auth/Login'
import Dashboard from './dashboard/Dashboard'
import Register from './register/Register'
import Inventory from './inventory/Inventory'
import SalesHistory from './sales/SalesHistory'
import Reports from './reports/Reports'
import Settings from './settings/Settings'
import Staff from './settings/Staff'

const DEFAULT_SETTINGS = {
  store_name: 'Sunrise Minimart',
  currency: 'KSh',
  tax_rate: 16,
  receipt_footer: 'Thank you, karibu tena!',
}

// Nav items per role group
const ADMIN_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '◉' },
  { key: 'inventory', label: 'Inventory', icon: '▤' },
  { key: 'sales',     label: 'Sales',     icon: '≡' },
  { key: 'reports',   label: 'Reports',   icon: '◔' },
  { key: 'staff',     label: 'Staff',     icon: '◎', ownerOnly: true },
  { key: 'settings',  label: 'Settings',  icon: '✦' },
]

const CASHIER_NAV = [
  { key: 'register',  label: 'Register',  icon: '▦' },
  { key: 'sales',     label: 'Sales',     icon: '≡' },
  { key: 'settings',  label: 'Settings',  icon: '✦' },
]

export default function App() {
  const { session, profile, loading, signOut } = useSession()
  const [view, setView]           = useState('register')      // corrected by role in useEffect
  const [settings, setSettings]   = useState(DEFAULT_SETTINGS)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [todayStats, setTodayStats] = useState({ total: 0, count: 0 })
  const { isOnline, pendingCount, syncing, syncErrors, setSyncErrors, refreshCount } = useOffline()
  const { isDark, toggle: toggleTheme } = useTheme()

  // Set the correct default view once, as soon as we know the user's role
  const viewInitialized = useRef(false)
  useEffect(() => {
    if (viewInitialized.current || !profile) return
    viewInitialized.current = true
    const isAdmin = profile.role === 'manager' || profile.role === 'owner'
    setView(isAdmin ? 'dashboard' : 'register')
  }, [profile])

  useEffect(() => {
    if (!session) return
    supabase.from('settings').select('*').single()
      .then(({ data }) => data && setSettings(data))
  }, [session])

  useEffect(() => {
    if (!session) return
    supabase.from('products').select('id, stock, low_at').eq('active', true)
      .then(({ data }) => setLowStockCount((data || []).filter(p => p.stock <= p.low_at).length))
  }, [session])

  const fetchTodayStats = useCallback(async () => {
    if (!session) return
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('sales')
      .select('total')
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
      .eq('status', 'completed')
    const rows = data || []
    setTodayStats({
      total: rows.reduce((s, x) => s + Number(x.total), 0),
      count: rows.length,
    })
  }, [session])

  useEffect(() => { fetchTodayStats() }, [fetchTodayStats])

  useEffect(() => {
    if (!session) return
    const ch = supabase
      .channel('sidebar-sales')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, payload => {
        setTodayStats(prev => ({
          total: prev.total + Number(payload.new.total),
          count: prev.count + 1,
        }))
        supabase.from('products').select('id, stock, low_at').eq('active', true)
          .then(({ data }) => setLowStockCount((data || []).filter(p => p.stock <= p.low_at).length))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [session])

  if (loading) return <div className="loading-screen">Loading…</div>
  if (!session) return <Login />

  const role    = profile?.role || 'cashier'
  const isAdmin = role === 'manager' || role === 'owner'
  const money   = n => formatMoney(n, settings.currency)

  const navItems = isAdmin
    ? ADMIN_NAV.filter(n => !n.ownerOnly || role === 'owner')
    : CASHIER_NAV

  const isViewAllowed = navItems.some(n => n.key === view)

  return (
    <div className="pos-root">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">{settings.store_name.slice(0, 1)}</div>
          <div className="brand-name">{settings.store_name}</div>
        </div>

        <div className="nav-section-label">{isAdmin ? 'Management' : 'Register'}</div>

        {navItems.map(n => (
          <button
            key={n.key}
            className={`nav-btn ${view === n.key ? 'active' : ''}`}
            onClick={() => setView(n.key)}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
            {n.key === 'inventory' && lowStockCount > 0 && (
              <span className="nav-badge">{lowStockCount}</span>
            )}
          </button>
        ))}

        <div className="sidebar-foot">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 12, paddingBottom: 12,
            borderBottom: '1px solid var(--sb-line)', fontSize: 12,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: syncing ? '#d08828' : isOnline ? '#4caf50' : '#d08828',
              boxShadow: isOnline && !syncing ? '0 0 0 2px rgba(76,175,80,.2)' : 'none',
            }} />
            <span style={{ color: syncing ? '#d08828' : isOnline ? '#6aaa7a' : '#d08828', fontSize: 12 }}>
              {syncing ? 'Syncing…' : isOnline ? 'Online' : `Offline${pendingCount > 0 ? ` · ${pendingCount} queued` : ''}`}
            </span>
          </div>

          <div className="foot-label">TODAY</div>
          <div className="foot-value">{money(todayStats.total)}</div>
          <div className="foot-sub">{todayStats.count} sale{todayStats.count === 1 ? '' : 's'}</div>
        </div>

        <div className="theme-toggle">
          <span className="theme-toggle-label">{isDark ? '🌙 Dark' : '☀️ Light'}</span>
          <button className={`toggle-track ${isDark ? 'on' : ''}`} onClick={toggleTheme} aria-label="Toggle dark mode">
            <div className="toggle-thumb" />
          </button>
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">
            {(profile?.full_name || 'C').slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--sb-text)', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.full_name || 'User'}
            </div>
            <div style={{ fontSize: 11, textTransform: 'capitalize', color: 'var(--sb-muted)' }}>{role}</div>
          </div>
        </div>

        <button className="signout-btn" onClick={signOut}>
          <span className="nav-icon">⏻</span>
          Sign out
        </button>
      </nav>

      <main className="main">
        {syncErrors.length > 0 && (
          <div style={{
            background: 'var(--red)', color: '#fff', padding: '10px 20px',
            fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            {syncErrors.length} offline sale{syncErrors.length > 1 ? 's' : ''} failed to sync. Contact your manager.
            <button onClick={() => setSyncErrors([])} style={{ background: 'rgba(255,255,255,.2)', border: 0, color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>
              Dismiss
            </button>
          </div>
        )}

        {/* Cashier views */}
        {!isAdmin && (view === 'register' || !isViewAllowed) && (
          <Register settings={settings} money={money} isOnline={isOnline} onSaleQueued={refreshCount} />
        )}

        {/* Admin views */}
        {isAdmin && (view === 'dashboard' || !isViewAllowed) && (
          <Dashboard money={money} role={role} onNavigate={setView} settings={settings} />
        )}

        {/* Shared views */}
        {isViewAllowed && view === 'inventory' && <Inventory money={money} />}
        {isViewAllowed && view === 'sales'     && <SalesHistory money={money} settings={settings} role={role} />}
        {isViewAllowed && view === 'reports'   && <Reports money={money} role={role} />}
        {isViewAllowed && view === 'staff'     && <Staff />}
        {isViewAllowed && view === 'settings'  && <Settings settings={settings} onSettingsChanged={setSettings} role={role} />}
      </main>
    </div>
  )
}
