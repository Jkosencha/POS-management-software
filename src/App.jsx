import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  LayoutDashboard, Package, Receipt, BarChart3, Users,
  Settings as SettingsIcon, ShoppingCart, LogOut, Moon, Sun,
} from 'lucide-react'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge,
  SidebarInset, SidebarTrigger,
} from '@/components/ui/sidebar'
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
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'inventory', label: 'Inventory', icon: Package },
  { key: 'sales',     label: 'Sales',     icon: Receipt },
  { key: 'reports',   label: 'Reports',   icon: BarChart3 },
  { key: 'staff',     label: 'Staff',     icon: Users, ownerOnly: true },
  { key: 'settings',  label: 'Settings',  icon: SettingsIcon },
]

const CASHIER_NAV = [
  { key: 'register',  label: 'Register',  icon: ShoppingCart },
  { key: 'sales',     label: 'Sales',     icon: Receipt },
  { key: 'settings',  label: 'Settings',  icon: SettingsIcon },
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
    <SidebarProvider className="bg-bg text-ink font-sans">
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2.5 px-1 pt-1 pb-1">
            <div className="w-9 h-9 rounded-[10px] shrink-0 flex items-center justify-center font-extrabold text-[17px] bg-sb-active-bg text-sb-active-fg shadow-sm">
              <span>{settings.store_name.slice(0, 1)}</span>
            </div>
            <div className="text-sb-text font-extrabold text-[13.5px] leading-tight tracking-tight">
              {settings.store_name}
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{isAdmin ? 'Management' : 'Register'}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map(n => {
                  const Icon = n.icon
                  return (
                    <SidebarMenuItem key={n.key}>
                      <SidebarMenuButton isActive={view === n.key} onClick={() => setView(n.key)}>
                        <Icon size={16} />
                        <span>{n.label}</span>
                      </SidebarMenuButton>
                      {n.key === 'inventory' && lowStockCount > 0 && (
                        <SidebarMenuBadge className="bg-accent text-white rounded-full">
                          {lowStockCount}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="border-t border-sb-line pt-3 px-1 pb-1 font-mono">
            <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-sb-line text-xs">
              <div
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: syncing ? '#d08828' : isOnline ? '#4caf50' : '#d08828',
                  boxShadow: isOnline && !syncing ? '0 0 0 2px rgba(76,175,80,.2)' : 'none',
                }}
              />
              <span className="text-xs" style={{ color: syncing ? '#d08828' : isOnline ? '#6aaa7a' : '#d08828' }}>
                {syncing ? 'Syncing…' : isOnline ? 'Online' : `Offline${pendingCount > 0 ? ` · ${pendingCount} queued` : ''}`}
              </span>
            </div>

            <div className="text-[10px] tracking-[.14em] text-sb-muted">TODAY</div>
            <div className="text-xl font-bold mt-0.5 text-sb-text">{money(todayStats.total)}</div>
            <div className="text-[11.5px] text-sb-muted mt-px">{todayStats.count} sale{todayStats.count === 1 ? '' : 's'}</div>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-bg">
        <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <span className="font-extrabold text-sm text-ink md:hidden">{settings.store_name}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              className={`w-9.5 h-5 rounded-full relative shrink-0 transition-colors border-[1.5px] ${
                isDark ? 'bg-accent border-accent' : 'bg-surface-2 border-line'
              }`}
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
            >
              <span className="sr-only">Toggle dark mode</span>
              {isDark ? <Moon size={11} className="absolute top-1 left-1 text-white" /> : <Sun size={11} className="absolute top-1 right-1 text-muted" />}
              <div
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all"
                style={{ left: isDark ? 22 : 2 }}
              />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-7.5 h-7.5 rounded-full shrink-0 flex items-center justify-center text-xs font-bold bg-lavender-bg text-lavender-fg">
                {(profile?.full_name || 'C').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 hidden sm:block">
                <div className="text-ink text-xs font-semibold overflow-hidden text-ellipsis whitespace-nowrap max-w-32">
                  {profile?.full_name || 'User'}
                </div>
                <div className="text-[11px] capitalize text-muted">{role}</div>
              </div>
            </div>

            <button
              className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-muted hover:bg-surface-2 hover:text-ink transition-colors"
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {syncErrors.length > 0 && (
          <div className="bg-red text-white px-5 py-2.5 text-sm font-semibold flex justify-between items-center">
            {syncErrors.length} offline sale{syncErrors.length > 1 ? 's' : ''} failed to sync. Contact your manager.
            <button
              onClick={() => setSyncErrors([])}
              className="bg-white/20 border-0 text-white rounded-md px-2.5 py-1 cursor-pointer font-bold"
            >
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
      </SidebarInset>
    </SidebarProvider>
  )
}
