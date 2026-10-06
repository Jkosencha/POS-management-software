import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import {
  LayoutDashboard, Package, Receipt, BarChart3, Users, Tags, Handshake,
  Settings as SettingsIcon, ShoppingCart, LogOut, Moon, Sun, Plus, CalendarDays, ClipboardCheck,
} from 'lucide-react'
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuBadge,
  SidebarInset, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar'
import { useSession } from './auth/useSession'
import { supabase } from './lib/supabase'
import { formatMoney } from './lib/money'
import { useOffline } from './lib/useOffline'
import { useTheme } from './lib/useTheme'
import BrandMark from './components/BrandMark'
import Login from './auth/Login'
import SetPassword from './auth/SetPassword'

// Pages load on demand so the first screen appears faster. The PWA precaches
// every chunk, so they still open offline.
const Dashboard    = lazy(() => import('./dashboard/Dashboard'))
const Register     = lazy(() => import('./register/Register'))
const Inventory    = lazy(() => import('./inventory/Inventory'))
const Categories   = lazy(() => import('./inventory/Categories'))
const Partners     = lazy(() => import('./partners/Partners'))
const SalesHistory = lazy(() => import('./sales/SalesHistory'))
const Reports      = lazy(() => import('./reports/Reports'))
const DayClose     = lazy(() => import('./reports/DayClose'))
const Settings     = lazy(() => import('./settings/Settings'))
const Staff        = lazy(() => import('./settings/Staff'))
const OfflineQueue = lazy(() => import('./register/OfflineQueue'))

const PageLoading = () => <div className="p-6 text-muted text-sm">Loading...</div>

const DEFAULT_SETTINGS = {
  store_name: 'Sunrise Minimart',
  currency: 'KSh',
  tax_rate: 16,
  receipt_footer: 'Thank you, karibu tena!',
}

// Nav items per role group
const ADMIN_NAV = [
  { key: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { key: 'register',   label: 'Register',   icon: ShoppingCart },
  { key: 'inventory',  label: 'Inventory',  icon: Package },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'partners',   label: 'Partners',   icon: Handshake },
  { key: 'sales',      label: 'Sales',      icon: Receipt },
  { key: 'reports',    label: 'Reports',    icon: BarChart3 },
  { key: 'staff',      label: 'Staff',      icon: Users, ownerOnly: true },
  { key: 'settings',   label: 'Settings',   icon: SettingsIcon },
]

const CASHIER_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'register',  label: 'Register',  icon: ShoppingCart },
  { key: 'inventory', label: 'Inventory', icon: Package },
  { key: 'sales',     label: 'Sales',     icon: Receipt },
  { key: 'settings',  label: 'Settings',  icon: SettingsIcon },
]

function greetingFor(date) {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// Nav button that also closes the mobile sheet after navigating
function NavButton({ item, active, onSelect }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const Icon = item.icon
  return (
    <SidebarMenuButton
      isActive={active}
      onClick={() => { onSelect(item.key); if (isMobile) setOpenMobile(false) }}
    >
      <Icon />
      <span>{item.label}</span>
    </SidebarMenuButton>
  )
}

function QuickAction({ icon: Icon, label, onClick }) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <button
      className="flex items-center gap-2 w-full rounded-full border border-line bg-surface px-3.5 h-9 text-[13px] font-semibold text-ink shadow-sm transition-colors hover:border-accent hover:text-accent"
      onClick={() => { onClick(); if (isMobile) setOpenMobile(false) }}
    >
      <Icon size={15} className="shrink-0" />
      {label}
    </button>
  )
}

export default function App() {
  const { session, profile, loading, signOut, mustSetPassword } = useSession()
  const [view, setView]           = useState('register')      // corrected by role in useEffect
  const [intent, setIntent]       = useState(null)            // one-shot action for the next view
  const [dayCloseOpen, setDayCloseOpen] = useState(false)
  const [settings, setSettings]   = useState(DEFAULT_SETTINGS)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [todayStats, setTodayStats] = useState({ total: 0, count: 0 })
  const { isOnline, pendingCount, syncing, syncErrors, setSyncErrors, refreshCount, flushQueue, discardPending } = useOffline()
  const [queueOpen, setQueueOpen] = useState(false)
  const { isDark, setMode: setThemeMode } = useTheme()

  // Set the correct default view once per signed-in user (a different
  // person can sign in on the same till without a page reload)
  const viewInitialized = useRef(null)
  useEffect(() => {
    if (!profile || viewInitialized.current === profile.id) return
    viewInitialized.current = profile.id
    const isAdmin = profile.role === 'manager' || profile.role === 'owner'
    setView(isAdmin ? 'dashboard' : 'register')
  }, [profile])

  useEffect(() => {
    if (!session) return
    supabase.from('settings').select('*').single()
      .then(({ data }) => data && setSettings(data))
  }, [session])

  const fetchLowStock = useCallback(() => {
    supabase.from('products').select('id, stock, low_at').eq('active', true)
      .then(({ data }) => setLowStockCount((data || []).filter(p => p.stock <= p.low_at).length))
  }, [])

  useEffect(() => { if (session) fetchLowStock() }, [session, fetchLowStock])

  const fetchTodayStats = useCallback(async () => {
    if (!session) return
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('sales')
      .select('total')
      .gte('created_at', start.toISOString())
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
        fetchLowStock()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [session, fetchLowStock])

  if (loading) return <div className="loading-screen">Loading...</div>
  if (!session) return <Login />
  if (mustSetPassword) return <SetPassword />

  const role    = profile?.role || 'cashier'
  const isAdmin = role === 'manager' || role === 'owner'
  const money   = n => formatMoney(n, settings.currency)

  const navItems = isAdmin
    ? ADMIN_NAV.filter(n => !n.ownerOnly || role === 'owner')
    : CASHIER_NAV

  const isViewAllowed = navItems.some(n => n.key === view)
  const navigate = (key, nextIntent = null) => { setView(key); setIntent(nextIntent) }
  const firstName = (profile?.full_name || 'there').split(' ')[0]
  const now = new Date()

  return (
    <SidebarProvider className="bg-bg text-ink font-sans">
      <Sidebar className="group-data-[side=left]:border-r-0">
        <SidebarHeader className="px-4 pt-5 pb-2">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="text-ink font-bold text-[15px] leading-tight tracking-tight truncate">
              {settings.store_name}
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-col gap-2 mt-5">
              <QuickAction icon={Plus} label="Add product" onClick={() => navigate('inventory', 'add-product')} />
              <QuickAction icon={ClipboardCheck} label="Close day" onClick={() => setDayCloseOpen(true)} />
            </div>
          )}
        </SidebarHeader>

        <SidebarContent className="px-2">
          <SidebarGroup>
            <SidebarGroupLabel className="text-muted">{isAdmin ? 'Management' : 'Register'}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {navItems.map(n => (
                  <SidebarMenuItem key={n.key}>
                    <NavButton item={n} active={view === n.key} onSelect={key => navigate(key)} />
                    {n.key === 'inventory' && lowStockCount > 0 && (
                      <SidebarMenuBadge className="top-2.5! right-2.5 bg-red text-white rounded-full peer-data-active/menu-button:bg-white peer-data-active/menu-button:text-accent">
                        {lowStockCount}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="px-4 pb-5">
          <div className="rounded-lg bg-surface p-3.5 shadow-sm">
            <button
              className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold disabled:cursor-default enabled:hover:underline"
              onClick={() => setQueueOpen(true)}
              disabled={pendingCount === 0}
              title={pendingCount > 0 ? 'Review offline sales' : undefined}
            >
              <span className={`size-2 rounded-full shrink-0 ${syncing || !isOnline || pendingCount > 0 ? 'bg-amber-warn' : 'bg-green'}`} />
              <span className={syncing || !isOnline || pendingCount > 0 ? 'text-amber-warn' : 'text-green'}>
                {syncing ? 'Syncing...' : isOnline ? 'Online' : 'Offline'}
                {pendingCount > 0 && ` · ${pendingCount} waiting to sync`}
              </span>
            </button>
            <div className="text-[11px] font-semibold text-muted">Today</div>
            <div className="text-lg font-bold text-ink leading-tight">{money(todayStats.total)}</div>
            <div className="text-xs text-muted">{todayStats.count} sale{todayStats.count === 1 ? '' : 's'}</div>
          </div>
          <button
            className="flex items-center gap-2.5 mt-2 rounded-full px-3 h-10 text-sm font-medium text-ink-2 transition-colors hover:bg-white hover:text-[#6a59e4] hover:shadow-sm"
            onClick={signOut}
          >
            <span className="size-6 rounded-full grid place-items-center bg-accent-tint text-accent"><LogOut size={13} /></span>
            Log out
          </button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-bg h-svh overflow-hidden">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <SidebarTrigger className="rounded-full" />
            <h1 className="m-0 text-lg sm:text-[26px] font-bold tracking-tight text-ink truncate">
              {greetingFor(now)}, {firstName}!
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-2 h-9 rounded-full bg-surface px-3.5 text-[13px] font-semibold text-ink-2 shadow-sm">
              <span className="size-5 rounded-md grid place-items-center bg-accent text-white"><CalendarDays size={12} /></span>
              {now.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}
            </div>

            <div className="flex items-center h-9 rounded-full bg-surface p-1 shadow-sm" role="group" aria-label="Theme">
              <button
                className={`size-7 rounded-full grid place-items-center transition-colors ${!isDark ? 'bg-ink text-surface' : 'text-muted hover:text-ink'}`}
                onClick={() => setThemeMode('light')}
                aria-label="Light mode" aria-pressed={!isDark}
              >
                <Sun size={14} />
              </button>
              <button
                className={`size-7 rounded-full grid place-items-center transition-colors ${isDark ? 'bg-ink text-surface' : 'text-muted hover:text-ink'}`}
                onClick={() => setThemeMode('dark')}
                aria-label="Dark mode" aria-pressed={isDark}
              >
                <Moon size={14} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="size-9 rounded-full shrink-0 grid place-items-center text-sm font-bold bg-accent text-white shadow-sm">
                {(profile?.full_name || 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 hidden lg:block">
                <div className="text-ink text-[13px] font-semibold truncate max-w-32">{profile?.full_name || 'User'}</div>
                <div className="text-[11px] capitalize text-muted">{role}</div>
              </div>
            </div>
          </div>
        </header>

        {syncErrors.length > 0 && (
          <div className="mx-2 sm:mx-3 mb-2 rounded-lg bg-red text-white px-5 py-2 text-sm font-semibold flex justify-between items-center gap-3">
            <span className="min-w-0">
              {syncErrors.length} offline sale{syncErrors.length > 1 ? 's' : ''} couldn't sync ({syncErrors[0].message}).
              Retrying every minute; tell your manager if this stays.
            </span>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => setQueueOpen(true)}
                className="bg-white text-red border-0 rounded-full px-3 py-1 cursor-pointer font-semibold"
              >
                Review
              </button>
              <button
                onClick={() => setSyncErrors([])}
                className="bg-white/20 border-0 text-white rounded-full px-3 py-1 cursor-pointer font-semibold"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 mx-2 mb-2 sm:mx-3 sm:mb-3 rounded-xl bg-panel overflow-y-auto">
          <Suspense fallback={<PageLoading />}>
          {/* Unknown view: fall back to each role's home page */}
          {(view === 'register' || (!isViewAllowed && !isAdmin)) && (
            <Register
              settings={settings} money={money} isOnline={isOnline} onSaleQueued={refreshCount}
              role={role} userId={session.user.id}
            />
          )}
          {(view === 'dashboard' || (!isViewAllowed && isAdmin)) && (
            <Dashboard money={money} onNavigate={navigate} role={role} />
          )}

          {/* Shared views */}
          {isViewAllowed && view === 'inventory'  && (
            <Inventory
              money={money}
              canManage={isAdmin}
              openAdd={isAdmin && intent === 'add-product'}
              onIntentHandled={() => setIntent(null)}
              onStockChanged={fetchLowStock}
            />
          )}
          {isViewAllowed && view === 'categories' && <Categories />}
          {isViewAllowed && view === 'partners'   && <Partners money={money} role={role} />}
          {isViewAllowed && view === 'sales'      && <SalesHistory money={money} settings={settings} role={role} />}
          {isViewAllowed && view === 'reports'    && <Reports money={money} role={role} />}
          {isViewAllowed && view === 'staff'      && <Staff />}
          {isViewAllowed && view === 'settings'   && <Settings settings={settings} onSettingsChanged={setSettings} role={role} />}
          </Suspense>
        </div>
      </SidebarInset>

      <Suspense fallback={null}>
        {dayCloseOpen && <DayClose money={money} onClose={() => setDayCloseOpen(false)} />}
        {queueOpen && (
          <OfflineQueue
            money={money}
            isOnline={isOnline}
            syncing={syncing}
            syncErrors={syncErrors}
            canDiscard={isAdmin}
            onRetry={flushQueue}
            onDiscard={discardPending}
            onClose={() => setQueueOpen(false)}
          />
        )}
      </Suspense>
    </SidebarProvider>
  )
}
