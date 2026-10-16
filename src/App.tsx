import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Download,
  HardHat,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Package,
  Plus,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import type { InventoryItem, InventoryStatus, Profile } from './lib/types'
import './App.css'

const QRCodeSVG = lazy(async () => ({ default: (await import('qrcode.react')).QRCodeSVG }))

type Section = 'Overview' | 'Inventory' | 'Scan equipment' | 'Transactions' | 'Maintenance' | 'Reports' | 'Settings'
type Notice = { kind: 'success' | 'error'; text: string }

const navItems: { label: Section; icon: typeof LayoutDashboard }[] = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Inventory', icon: Boxes },
  { label: 'Scan equipment', icon: QrCode },
  { label: 'Transactions', icon: ArrowLeftRight },
  { label: 'Maintenance', icon: Wrench },
  { label: 'Reports', icon: ClipboardList },
]

const statusLabel: Record<InventoryStatus, string> = {
  available: 'Available',
  assigned: 'In use',
  in_transit: 'In transit',
  maintenance: 'Maintenance',
  damaged: 'Damaged',
  missing: 'Missing',
  retired: 'Retired',
}

function App() {
  const [section, setSection] = useState<Section>(() => window.location.pathname.startsWith('/inventory/') ? 'Inventory' : 'Overview')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [authenticated, setAuthenticated] = useState(false)
  const configured = Boolean(supabase)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [search, setSearch] = useState(() => window.location.pathname.startsWith('/inventory/') ? window.location.pathname.split('/').filter(Boolean).at(-1) ?? '' : '')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showNewItem, setShowNewItem] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const notify = useCallback((next: Notice) => {
    setNotice(next)
    window.setTimeout(() => setNotice(null), 4500)
  }, [])

  const loadInventory = useCallback(async () => {
    if (!supabase) {
      return
    }
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, name, tracking_type, asset_tag, serial_number, status, quantity, unit, purchase_cost, minimum_stock, created_at, updated_at, location:inventory_locations(name), category:equipment_categories(name)')
      .order('updated_at', { ascending: false })
    if (error) {
      notify({ kind: 'error', text: error.message })
      setItems([])
    } else {
      setItems((data ?? []) as unknown as InventoryItem[])
    }
    setLoading(false)
  }, [notify])

  useEffect(() => {
    if (!supabase) {
      return
    }
    let alive = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive) return
      setAuthenticated(Boolean(session))
      if (session) void loadProfile()
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session))
      if (session) {
        setLoading(true)
        window.setTimeout(() => { void loadProfile() }, 0)
      } else {
        setProfile(null)
        setItems([])
        setLoading(false)
      }
    })
    return () => {
      alive = false
      subscription.unsubscribe()
    }

    async function loadProfile() {
      if (!supabase) return
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        setLoading(false)
        return
      }
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, role')
        .eq('id', userId)
        .maybeSingle()
      if (error) notify({ kind: 'error', text: error.message })
      setProfile(data as Profile | null)
      await loadInventory()
    }
  }, [loadInventory, notify])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      const matchesQuery = !query || [
        item.id,
        item.name,
        item.asset_tag,
        item.serial_number,
        item.category?.name,
        item.location?.name,
      ].some((value) => value?.toLowerCase().includes(query))
      return matchesQuery && (statusFilter === 'all' || item.status === statusFilter)
    })
  }, [items, search, statusFilter])

  const metrics = useMemo(() => ({
    total: items.filter((item) => item.tracking_type === 'asset').length,
    available: items.filter((item) => item.status === 'available').length,
    assigned: items.filter((item) => item.status === 'assigned').length,
    maintenance: items.filter((item) => item.status === 'maintenance' || item.status === 'damaged').length,
    lowStock: items.filter((item) => item.tracking_type === 'stock' && Number(item.quantity) <= Number(item.minimum_stock)).length,
    totalValue: items.reduce((sum, item) => sum + Number(item.purchase_cost ?? 0) * (item.tracking_type === 'stock' ? Number(item.quantity) : 1), 0),
  }), [items])

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) notify({ kind: 'error', text: error.message })
  }

  const scanResult = useCallback(async (decodedText: string) => {
    if (!supabase) return
    let identifier = decodedText.trim()
    if (/^https?:\/\//i.test(identifier)) {
      try {
        identifier = new URL(identifier).pathname.split('/').filter(Boolean).at(-1) ?? ''
      } catch {
        notify({ kind: 'error', text: 'This QR code does not contain a valid inventory link.' })
        return
      }
    }
    if (!identifier) {
      notify({ kind: 'error', text: 'This QR code does not contain an inventory identifier.' })
      return
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier)
    const query = supabase.from('inventory_items').select('id')
    const { data, error } = isUuid
      ? await query.eq('id', identifier).maybeSingle()
      : await query.eq('asset_tag', identifier).maybeSingle()
    if (error) notify({ kind: 'error', text: error.message })
    else if (!data) notify({ kind: 'error', text: 'No inventory item matches this QR code.' })
    else {
      setSection('Inventory')
      setSearch(identifier)
      notify({ kind: 'success', text: 'Item found. Showing the matching inventory record.' })
    }
  }, [notify])

  if (configured && !authenticated) {
    return <Login onNotify={notify} notice={notice} />
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><HardHat size={21} strokeWidth={2.4} /></div>
          <div className="brand-copy"><strong className="brand-main">Asia Best</strong><span className="brand-subline">Construction and Development<br />Corporation</span><small>Equipment Tracker</small></div>
          <button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-icon"><Building2 size={17} /></div>
          <div className="workspace-text"><strong>ABCD Operations</strong><small>Equipment workspace</small></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-link ${section === label ? 'active' : ''}`} onClick={() => { setSection(label); setSidebarOpen(false) }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {label === 'Inventory' && <span className="nav-count">{items.length}</span>}
            </button>
          ))}
        </nav>
        <div className="nav-caption nav-caption-lower">MANAGE</div>
        <button className={`nav-link ${section === 'Settings' ? 'active' : ''}`} onClick={() => { setSection('Settings'); setSidebarOpen(false) }}><Settings size={18} strokeWidth={1.8} /><span>Settings</span></button>
        <div className="sidebar-spacer" />
        <div className="help-card">
          <div className="help-icon"><ShieldCheck size={17} /></div>
          <strong>Need a hand?</strong>
          <p>Our support team is here to help your crew.</p>
          <button onClick={() => notify({ kind: 'success', text: 'Contact your Asia Best workspace administrator for support.' })}>Contact support <ArrowUpRight size={13} /></button>
        </div>
        <div className="profile-box">
          <div className="avatar">{(profile?.full_name ?? 'FT').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
          <div className="profile-info"><strong>{profile?.full_name ?? (configured ? 'Team member' : 'Preview mode')}</strong><small>{profile?.role?.replaceAll('_', ' ') ?? 'Connect Supabase to sign in'}</small></div>
          {configured && <button className="icon-button" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button>}
        </div>
      </aside>

      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button menu-toggle" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{section}</strong></div>
          <div className="topbar-actions">
            <div className="live-indicator"><span /> {configured ? 'Live data' : 'Preview mode'}</div>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => notify({ kind: 'success', text: metrics.lowStock ? `${metrics.lowStock} low-stock item${metrics.lowStock === 1 ? '' : 's'} need attention.` : 'You’re all caught up.' })}><Bell size={18} />{metrics.lowStock > 0 && <i />}</button>
            <div className="top-avatar">{(profile?.full_name ?? 'FT').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>
          </div>
        </header>

        <div className="page-wrap">
          {!configured && <div className="setup-banner"><CircleAlert size={17} /><span><strong>Backend not connected.</strong> Add your Supabase URL and anon key in <code>.env.local</code> to enable live inventory and sign-in.</span></div>}
          {section === 'Overview' && <Overview items={items} metrics={metrics} loading={loading} onNavigate={setSection} />}
          {section === 'Inventory' && <InventoryPage items={filteredItems} allItems={items} loading={loading} search={search} setSearch={setSearch} statusFilter={statusFilter} setStatusFilter={setStatusFilter} canManageInventory={profile?.role === 'administrator' || profile?.role === 'inventory_manager'} onAdd={() => setShowNewItem(true)} onRefresh={() => void loadInventory()} notify={notify} />}
          {section === 'Scan equipment' && <ScanPage onScan={scanResult} onSearch={(value) => { setSearch(value); setSection('Inventory') }} />}
          {section === 'Transactions' && <TransactionsPage items={items} profile={profile} notify={notify} onRefresh={() => void loadInventory()} />}
          {section === 'Maintenance' && <MaintenancePage items={items} profile={profile} notify={notify} onRefresh={() => void loadInventory()} />}
          {section === 'Reports' && <ReportsPage items={items} profile={profile} notify={notify} />}
          {section === 'Settings' && <SettingsPage profile={profile} configured={configured} />}
        </div>
      </main>

      {showNewItem && <NewItemModal onClose={() => setShowNewItem(false)} onSaved={() => { setShowNewItem(false); void loadInventory() }} notify={notify} />}
      {notice && <div className={`toast toast-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}</span>{notice.text}<button aria-label="Dismiss" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    </div>
  )
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>
}

function Overview({ items, metrics, loading, onNavigate }: { items: InventoryItem[]; metrics: { total: number; available: number; assigned: number; maintenance: number; lowStock: number; totalValue: number }; loading: boolean; onNavigate: (section: Section) => void }) {
  const locations = useMemo(() => {
    const counts = new Map<string, number>()
    items.forEach((item) => {
      const name = item.location?.name ?? 'Unassigned'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    })
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [items])
  const maxLocation = Math.max(1, ...locations.map(([, count]) => count))

  return <>
    <PageHeading eyebrow="FIELD OPERATIONS" title="Your inventory at a glance" description="Here’s what’s happening across your equipment and materials." action={<button className="button button-primary" onClick={() => onNavigate('Scan equipment')}><QrCode size={16} /> Scan equipment</button>} />
    <section className="metric-grid" aria-label="Inventory key performance indicators">
      <MetricCard label="Registered assets" value={loading ? '—' : metrics.total.toLocaleString()} hint="Individually tracked" icon={Package} tone="blue" />
      <MetricCard label="Available to deploy" value={loading ? '—' : metrics.available.toLocaleString()} hint="Ready for your crew" icon={Check} tone="green" />
      <MetricCard label="Currently in use" value={loading ? '—' : metrics.assigned.toLocaleString()} hint="Assigned equipment" icon={BriefcaseBusiness} tone="purple" />
      <MetricCard label="Needs attention" value={loading ? '—' : (metrics.maintenance + metrics.lowStock).toLocaleString()} hint={`${metrics.maintenance} service · ${metrics.lowStock} low stock`} icon={Activity} tone="orange" />
    </section>
    <section className="overview-grid">
      <div className="panel status-panel">
        <div className="panel-head"><div><h2>Equipment status</h2><p>Current fleet availability</p></div><button className="text-button" onClick={() => onNavigate('Inventory')}>View inventory <ArrowUpRight size={14} /></button></div>
        <div className="status-summary">
          <div className="donut-wrap"><div className="donut" style={{ '--available': `${items.length ? metrics.available / items.length * 100 : 0}%`, '--assigned': `${items.length ? metrics.assigned / items.length * 100 : 0}%` } as React.CSSProperties}><div><strong>{items.length.toLocaleString()}</strong><small>total items</small></div></div></div>
          <div className="legend">
            <LegendRow label="Available" value={metrics.available} color="green" total={items.length} />
            <LegendRow label="In use" value={metrics.assigned} color="blue" total={items.length} />
            <LegendRow label="In maintenance" value={items.filter((item) => item.status === 'maintenance').length} color="orange" total={items.length} />
            <LegendRow label="Other" value={items.filter((item) => !['available', 'assigned', 'maintenance'].includes(item.status)).length} color="gray" total={items.length} />
          </div>
        </div>
        <div className="panel-foot"><span><span className="foot-dot" /> Purchase value</span><strong>{formatCurrency(metrics.totalValue)}</strong></div>
      </div>
      <div className="panel location-panel">
        <div className="panel-head"><div><h2>By location</h2><p>Equipment distribution</p></div><button className="more-button" aria-label="Location options"><SlidersHorizontal size={16} /></button></div>
        {locations.length ? <div className="location-bars">{locations.map(([name, count], index) => <div className="location-row" key={name}><div className="location-label"><span><MapPin size={14} />{name}</span><strong>{count}</strong></div><div className="bar-track"><div className={`bar-fill bar-${index}`} style={{ width: `${count / maxLocation * 100}%` }} /></div></div>)}</div> : <EmptyInline text="Locations appear here as inventory is added." />}
        <button className="location-link" onClick={() => onNavigate('Inventory')}>Explore all inventory <ArrowUpRight size={14} /></button>
      </div>
    </section>
    <section className="panel recent-panel">
      <div className="panel-head"><div><h2>Recently updated</h2><p>Your latest inventory changes</p></div><button className="text-button" onClick={() => onNavigate('Inventory')}>All inventory <ArrowUpRight size={14} /></button></div>
      <InventoryTable items={items.slice(0, 5)} compact />
      {!items.length && <EmptyState icon={Boxes} title="No inventory yet" description="Connect your database and register your first asset to see it here." />}
    </section>
  </>
}

function MetricCard({ label, value, hint, icon: Icon, tone }: { label: string; value: string; hint: string; icon: typeof Package; tone: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div><div className="metric-value">{value}</div><div className="metric-hint">{hint}</div></div>
}

function LegendRow({ label, value, color, total }: { label: string; value: number; color: string; total: number }) {
  return <div className="legend-row"><span><i className={`legend-dot ${color}`} />{label}</span><strong>{value}<small>{total ? ` · ${Math.round(value / total * 100)}%` : ''}</small></strong></div>
}

function InventoryPage({ items, allItems, loading, search, setSearch, statusFilter, setStatusFilter, canManageInventory, onAdd, onRefresh, notify }: { items: InventoryItem[]; allItems: InventoryItem[]; loading: boolean; search: string; setSearch: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; canManageInventory: boolean; onAdd: () => void; onRefresh: () => void; notify: (notice: Notice) => void }) {
  const [itemForQr, setItemForQr] = useState<InventoryItem | null>(null)
  const [itemForHistory, setItemForHistory] = useState<InventoryItem | null>(null)
  const exportCsv = () => {
    const rows = [['Name', 'Asset tag', 'Category', 'Status', 'Location', 'Quantity', 'Unit'], ...items.map((item) => [item.name, item.asset_tag ?? '', item.category?.name ?? '', item.status, item.location?.name ?? '', String(item.quantity ?? 1), item.unit ?? ''])]
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'asia-best-inventory.csv'
    link.click()
    URL.revokeObjectURL(url)
    notify({ kind: 'success', text: 'Inventory CSV exported.' })
  }
  return <>
    <PageHeading eyebrow="ASSET REGISTER" title="Inventory" description="Keep track of every tool, machine, and material in your operation." action={<><button className="button button-secondary" onClick={exportCsv}><Download size={16} /> Export</button>{canManageInventory && <button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add inventory</button>}</>} />
    <div className="inventory-summary-row"><div><strong>{allItems.length.toLocaleString()}</strong><span> total records</span></div><div className="inventory-summary-chips"><span><i className="legend-dot green" />{allItems.filter((item) => item.status === 'available').length} available</span><span><i className="legend-dot blue" />{allItems.filter((item) => item.status === 'assigned').length} in use</span><span><i className="legend-dot orange" />{allItems.filter((item) => item.status === 'maintenance' || item.status === 'damaged').length} needs attention</span></div></div>
    <div className="panel inventory-panel">
      <div className="table-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, tag, serial number..." /></label><div className="toolbar-right"><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="icon-button filter-button" aria-label="Refresh inventory" onClick={onRefresh}><SlidersHorizontal size={16} /></button></div></div>
      {loading ? <LoadingState /> : items.length ? <InventoryTable items={items} onQr={setItemForQr} onHistory={setItemForHistory} /> : <EmptyState icon={Boxes} title={search || statusFilter !== 'all' ? 'No matching inventory' : 'No inventory registered'} description={search || statusFilter !== 'all' ? 'Try changing your search or status filter.' : 'Register an asset or connect your Supabase database to get started.'} action={!search && statusFilter === 'all' && canManageInventory ? <button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add inventory</button> : undefined} />}
    </div>
    {itemForQr && <Modal title="QR asset label" subtitle={itemForQr.name} onClose={() => setItemForQr(null)}><div className="qr-print-card"><Suspense fallback={<LoadingState />}><QRCodeSVG value={`${window.location.origin}/inventory/${itemForQr.id}`} size={190} level="M" /></Suspense><strong>{itemForQr.name}</strong><span>{itemForQr.asset_tag ?? itemForQr.id}</span><button className="button button-primary print-button" onClick={() => window.print()}>Print label</button></div></Modal>}
    {itemForHistory && <MovementHistoryModal item={itemForHistory} onClose={() => setItemForHistory(null)} />}
  </>
}

function InventoryTable({ items, compact = false, onQr, onHistory }: { items: InventoryItem[]; compact?: boolean; onQr?: (item: InventoryItem) => void; onHistory?: (item: InventoryItem) => void }) {
  if (!items.length) return null
  const hasActions = !compact && Boolean(onQr || onHistory)
  return <div className="table-scroll"><table className="inventory-table"><thead><tr><th>ITEM</th><th>ASSET TAG</th><th>LOCATION</th><th>STATUS</th><th>{compact ? 'UPDATED' : 'QUANTITY'}</th>{hasActions && <th aria-label="Actions" />}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className="item-cell"><div className={`item-avatar ${item.tracking_type === 'stock' ? 'stock-avatar' : ''}`}>{item.tracking_type === 'stock' ? <Boxes size={16} /> : <Package size={16} />}</div><div><strong>{item.name}</strong><small>{item.category?.name ?? (item.tracking_type === 'stock' ? 'Bulk material' : 'Equipment asset')}</small></div></div></td><td><span className="asset-code">{item.asset_tag ?? '—'}</span></td><td><span className="table-location"><MapPin size={13} />{item.location?.name ?? 'Unassigned'}</span></td><td><StatusBadge status={item.status} /></td><td>{compact ? <span className="date-text">{formatDate(item.updated_at)}</span> : <strong className="quantity-text">{item.tracking_type === 'stock' ? `${Number(item.quantity).toLocaleString()} ${item.unit ?? ''}` : '1 unit'}</strong>}</td>{hasActions && <td className="table-actions">{onQr && <button className="icon-button qr-action" title="Show QR label" onClick={() => onQr(item)}><QrCode size={16} /></button>}{onHistory && <button className="icon-button qr-action" title="View movement history" onClick={() => onHistory(item)}><ClipboardList size={16} /></button>}</td>}</tr>)}</tbody></table></div>
}

type MovementRecord = { id: string; action: string; quantity: number; quantity_before: number | null; quantity_after: number | null; employee_name: string | null; notes: string | null; created_at: string; performed_by: string | null }

function MovementHistoryModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const [records, setRecords] = useState<MovementRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(Boolean(supabase))
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) return
    void supabase.from('inventory_transactions')
      .select('id, action, quantity, quantity_before, quantity_after, employee_name, notes, created_at, performed_by')
      .eq('item_id', item.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message)
        else setRecords((data ?? []) as MovementRecord[])
        setLoadingHistory(false)
      })
  }, [item.id])
  return <Modal title="Movement history" subtitle={`${item.name} · ${item.asset_tag ?? item.id}`} onClose={onClose}>{loadingHistory ? <LoadingState /> : error ? <div className="inline-error">{error}</div> : records.length ? <div className="movement-list">{records.map((record) => <article className="movement-entry" key={record.id}><span className="movement-mark"><ArrowLeftRight size={15} /></span><div className="movement-main"><strong>{record.action.replaceAll('_', ' ')}</strong><small>{formatDate(record.created_at)} · {new Date(record.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>{record.employee_name && <p>Custodian: {record.employee_name}</p>}{record.notes && <p>{record.notes}</p>}</div><span className="movement-quantity">{record.quantity_before !== null && record.quantity_after !== null ? `${Number(record.quantity_before).toLocaleString()} → ${Number(record.quantity_after).toLocaleString()}` : `${record.quantity} ${item.unit ?? 'unit'}`}</span></article>)}</div> : <EmptyState icon={ClipboardList} title="No movements recorded" description="Checkout, return, stock, and other transactions will be listed here." />}</Modal>
}

function StatusBadge({ status }: { status: InventoryStatus }) {
  const tone = status === 'available' ? 'green' : status === 'assigned' ? 'blue' : status === 'maintenance' || status === 'in_transit' ? 'orange' : status === 'damaged' || status === 'missing' ? 'red' : 'gray'
  return <span className={`status-badge ${tone}`}><i />{statusLabel[status]}</span>
}

function ScanPage({ onScan, onSearch }: { onScan: (value: string) => void; onSearch: (value: string) => void }) {
  const [manual, setManual] = useState('')
  const [scannerError, setScannerError] = useState('')
  useEffect(() => {
    let scanner: import('html5-qrcode').Html5QrcodeScanner | undefined
    let active = true
    void import('html5-qrcode').then(({ Html5QrcodeScanner: Scanner }) => {
      if (!active) return
      scanner = new Scanner('qr-reader', { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1, videoConstraints: { facingMode: { ideal: 'environment' } }, rememberLastUsedCamera: true, showTorchButtonIfSupported: true }, false)
      scanner.render((decodedText) => {
        if (scanner) void scanner.clear()
        onScan(decodedText)
      }, (errorMessage) => {
        if (errorMessage.includes('NotAllowedError') || errorMessage.includes('Permission')) {
          setScannerError('Camera access was denied. Allow camera access in your browser settings or search by asset ID below.')
        }
      })
    }).catch((error: unknown) => {
      setScannerError(error instanceof Error ? error.message : 'The QR scanner could not be loaded.')
    })
    return () => {
      active = false
      if (scanner) void scanner.clear().catch(() => undefined)
    }
  }, [onScan])
  return <>
    <PageHeading eyebrow="MOBILE-READY SCANNER" title="Scan equipment" description="Point your camera at any Asia Best QR label to open an asset record." />
    <div className="scan-layout">
      <div className="panel scanner-panel"><div className="scanner-heading"><span className="scanner-badge"><QrCode size={17} /></span><div><strong>QR scanner</strong><small>Rear camera preferred</small></div><span className="scan-live"><i /> READY</span></div>{scannerError && <div className="inline-error">{scannerError}</div>}<div id="qr-reader" className="qr-reader" /><p className="scanner-tip">Allow camera access when prompted. Best results in good lighting.</p></div>
      <div className="scan-side"><div className="panel scan-help"><h2>Quick scan tips</h2><div className="scan-tip-row"><span>01</span><p>Hold your phone steady, about 15–25 cm from the QR label.</p></div><div className="scan-tip-row"><span>02</span><p>Keep the label inside the frame and avoid glare from direct sunlight.</p></div><div className="scan-tip-row"><span>03</span><p>After scanning, verify the item before starting a transaction.</p></div></div><div className="panel manual-search"><div className="manual-icon"><Search size={18} /></div><h2>Can’t scan the code?</h2><p>Enter the asset tag or inventory ID to find it manually.</p><form onSubmit={(event) => { event.preventDefault(); if (manual.trim()) onSearch(manual.trim()) }}><input aria-label="Asset tag or inventory ID" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="e.g. GEN-0248" /><button className="button button-primary" disabled={!manual.trim()}><Search size={15} /> Find item</button></form></div></div>
    </div>
  </>
}

function TransactionsPage({ items, profile, notify, onRefresh }: { items: InventoryItem[]; profile: Profile | null; notify: (notice: Notice) => void; onRefresh: () => void }) {
  const [selected, setSelected] = useState('')
  const [action, setAction] = useState<'checkout' | 'return' | 'transfer' | 'stock'>('checkout')
  const [employee, setEmployee] = useState('')
  const [project, setProject] = useState('')
  const [destination, setDestination] = useState('')
  const [condition, setCondition] = useState('good')
  const [stockAction, setStockAction] = useState<'stock_receipt' | 'stock_issue' | 'stock_adjustment'>('stock_issue')
  const [quantity, setQuantity] = useState('1')
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([])
  const [pendingTransfers, setPendingTransfers] = useState<{ id: string; item_id: string; from_location_id: string; to_location_id: string; receiver_name: string; sent_at: string }[]>([])
  const [busy, setBusy] = useState(false)
  const role = profile?.role
  const canOperateAssets = role === 'administrator' || role === 'inventory_manager' || role === 'site_supervisor' || role === 'equipment_custodian'
  const canOperateStock = role === 'administrator' || role === 'inventory_manager' || role === 'site_supervisor'
  const assets = items.filter((item) => item.tracking_type === 'asset' && (action === 'return' ? item.status === 'assigned' : item.status === 'available') && (action !== 'transfer' || item.location !== null))
  const stockItems = items.filter((item) => item.tracking_type === 'stock')
  const itemChoices = action === 'stock' ? stockItems : assets
  const loadPendingTransfers = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('equipment_transfers')
      .select('id, item_id, from_location_id, to_location_id, receiver_name, sent_at')
      .eq('status', 'pending')
      .order('sent_at', { ascending: false })
    if (error) notify({ kind: 'error', text: error.message })
    else setPendingTransfers(data ?? [])
  }, [notify])
  useEffect(() => {
    if (!supabase) return
    void supabase.from('inventory_locations').select('id, name').eq('active', true).order('name')
      .then(({ data, error }) => {
        if (error) notify({ kind: 'error', text: error.message })
        else setLocations(data ?? [])
      })
    void loadPendingTransfers()
  }, [loadPendingTransfers, notify])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase || !selected) return
    const chosenItem = itemChoices.find((item) => item.id === selected)
    const destinationName = locations.find((location) => location.id === destination)?.name
    const actionName = action === 'checkout' ? 'check out' : action === 'return' ? 'return' : action === 'transfer' ? 'transfer' : 'record a stock movement for'
    const detail = action === 'checkout' ? `Recipient: ${employee}\nProject: ${project}` : action === 'transfer' ? `Receiver: ${employee}\nDestination: ${destinationName ?? 'not selected'}` : action === 'return' ? `Return condition: ${condition.replaceAll('_', ' ')}` : `Movement: ${stockAction.replaceAll('_', ' ')}\nQuantity: ${quantity}`
    if (!window.confirm(`Confirm ${actionName} ${chosenItem?.name ?? 'this item'}?\n${detail}`)) return
    setBusy(true)
    let error: { message: string } | null = null
    if (action === 'checkout') {
      const result = await supabase.rpc('checkout_asset', { p_item_id: selected, p_employee_name: employee.trim(), p_project_name: project.trim(), p_expected_return_at: null, p_notes: null })
      error = result.error
    } else if (action === 'return') {
      const result = await supabase.rpc('return_asset', { p_item_id: selected, p_condition: condition, p_location_id: null, p_notes: null })
      error = result.error
    } else if (action === 'transfer') {
      const result = await supabase.rpc('start_equipment_transfer', { p_item_id: selected, p_to_location_id: destination, p_receiver_name: employee.trim(), p_notes: null })
      error = result.error
    } else {
      const result = await supabase.rpc('move_stock', { p_item_id: selected, p_quantity: Number(quantity), p_action: stockAction, p_notes: null })
      error = result.error
    }
    setBusy(false)
    if (error) notify({ kind: 'error', text: error.message })
    else {
      notify({ kind: 'success', text: action === 'checkout' ? 'Equipment checked out successfully.' : action === 'return' ? 'Equipment returned successfully.' : action === 'transfer' ? 'Transfer started. The asset is now in transit.' : 'Stock movement recorded.' })
      setSelected('')
      setEmployee('')
      setProject('')
      setDestination('')
      onRefresh()
      void loadPendingTransfers()
    }
  }
  async function receiveTransfer(transferId: string) {
    if (!supabase || busy) return
    if (!window.confirm(`Confirm receipt of transfer ${transferId.slice(0, 8)}?\nReceived condition: ${condition.replaceAll('_', ' ')}`)) return
    setBusy(true)
    const { error } = await supabase.rpc('receive_equipment_transfer', { p_transfer_id: transferId, p_condition: condition, p_notes: null })
    setBusy(false)
    if (error) notify({ kind: 'error', text: error.message })
    else {
      notify({ kind: 'success', text: 'Transfer receipt confirmed and location updated.' })
      onRefresh()
      void loadPendingTransfers()
    }
  }
  const switchAction = (next: typeof action) => { setAction(next); setSelected('') }
  return <>
    <PageHeading eyebrow="ACCOUNTABILITY" title="Transactions" description="Check equipment in and out, transfer assets between sites, and manage material quantities." />
    <div className="transaction-layout"><div className="panel transaction-form-panel">{canOperateAssets || canOperateStock ? <><div className="transaction-tabs">{canOperateAssets && <><button className={action === 'checkout' ? 'selected' : ''} onClick={() => switchAction('checkout')}><ArrowUpRight size={16} /> Check out</button><button className={action === 'return' ? 'selected' : ''} onClick={() => switchAction('return')}><ArrowDownLeft size={16} /> Return</button><button className={action === 'transfer' ? 'selected' : ''} onClick={() => switchAction('transfer')}><ArrowLeftRight size={16} /> Transfer</button></>}{canOperateStock && <button className={action === 'stock' ? 'selected' : ''} onClick={() => switchAction('stock')}><Boxes size={16} /> Stock</button>}</div><form className="form-grid" onSubmit={(event) => void submit(event)}>
      <label className="form-field full"><span>{action === 'stock' ? 'Bulk inventory item' : 'Equipment asset'} <b>*</b></span><select required value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select an item...</option>{itemChoices.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.asset_tag ?? item.id.slice(0, 8)}</option>)}</select>{itemChoices.length === 0 && <small>No eligible {action === 'return' ? 'issued' : action === 'stock' ? 'bulk stock' : 'available'} items found.</small>}</label>
      {action === 'checkout' && <><label className="form-field"><span>Received by <b>*</b></span><input required value={employee} onChange={(event) => setEmployee(event.target.value)} placeholder="Employee or contractor" /></label><label className="form-field"><span>Project / site <b>*</b></span><input required value={project} onChange={(event) => setProject(event.target.value)} placeholder="Existing active project name" /></label></>}
      {action === 'transfer' && <><label className="form-field"><span>Receiving location <b>*</b></span><select required value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Select destination...</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="form-field"><span>Receiver name <b>*</b></span><input required value={employee} onChange={(event) => setEmployee(event.target.value)} placeholder="Person accepting delivery" /></label></>}
      {action === 'return' && <label className="form-field full"><span>Condition on return</span><select value={condition} onChange={(event) => setCondition(event.target.value)}><option value="good">Good — available for use</option><option value="fair">Fair — hold for inspection</option><option value="poor">Poor — do not issue</option><option value="damaged">Damaged — do not issue</option><option value="missing_parts">Missing parts — do not issue</option></select></label>}
      {action === 'stock' && <><label className="form-field"><span>Movement type</span><select value={stockAction} onChange={(event) => setStockAction(event.target.value as typeof stockAction)}><option value="stock_issue">Issue / consume</option><option value="stock_receipt">Receive stock</option><option value="stock_adjustment">Set counted balance</option></select></label><label className="form-field"><span>{stockAction === 'stock_adjustment' ? 'New counted balance' : 'Quantity'} <b>*</b></span><input type="number" min={stockAction === 'stock_adjustment' ? '0' : '0.001'} step="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label></>}
      <div className="form-note full"><ShieldCheck size={16} /><span>Transactions are server-validated and recorded atomically. Duplicate assignments and negative stock balances are rejected by the database.</span></div><div className="full form-submit"><button className="button button-primary" disabled={!supabase || !selected || busy || (action === 'transfer' && !destination)}>{busy ? <LoaderCircle className="spin" size={16} /> : action === 'checkout' ? <ArrowUpRight size={16} /> : action === 'return' ? <ArrowDownLeft size={16} /> : action === 'transfer' ? <ArrowLeftRight size={16} /> : <Boxes size={16} />}{action === 'checkout' ? 'Confirm checkout' : action === 'return' ? 'Confirm return' : action === 'transfer' ? 'Start transfer' : 'Record stock movement'}</button></div></form></> : <EmptyState icon={ShieldCheck} title="No transaction permission" description="Your assigned role is read-only. Ask an administrator or inventory manager if you need to process a movement." />}</div>
    <div className="panel transaction-note"><div className="note-icon"><ClipboardList size={18} /></div><h2>Every move, accounted for.</h2><p>Asset transfers remain pending until an authorized person at the destination confirms receipt and condition.</p><ul><li><Check size={15} /> Actor and timestamp recorded</li><li><Check size={15} /> Item availability or quantity updated atomically</li><li><Check size={15} /> Movement history is immutable</li></ul></div></div>
    <section className="panel pending-transfers"><div className="panel-head"><div><h2>Pending transfer receipts</h2><p>Confirm arrival only after checking the equipment and its condition.</p></div><span className="count-pill">{pendingTransfers.length} pending</span></div>{pendingTransfers.length > 0 && canOperateAssets && <label className="form-field receipt-condition"><span>Condition of received equipment</span><select value={condition} onChange={(event) => setCondition(event.target.value)}><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor — hold from use</option><option value="damaged">Damaged — hold from use</option><option value="missing_parts">Missing parts — hold from use</option></select></label>}{pendingTransfers.length ? <div className="table-scroll"><table className="inventory-table"><thead><tr><th>ASSET ID</th><th>RECEIVER</th><th>TRANSFER DATE</th><th>DESTINATION ID</th><th /></tr></thead><tbody>{pendingTransfers.map((transfer) => <tr key={transfer.id}><td><span className="asset-code">{transfer.item_id}</span></td><td>{transfer.receiver_name}</td><td>{formatDate(transfer.sent_at)}</td><td><span className="asset-code">{transfer.to_location_id.slice(0, 8)}</span></td><td>{canOperateAssets && <button className="button button-secondary receive-button" disabled={busy} onClick={() => void receiveTransfer(transfer.id)}><Check size={14} /> Confirm receipt</button>}</td></tr>)}</tbody></table></div> : <EmptyState icon={ArrowLeftRight} title="No transfers awaiting receipt" description="New transfers will appear here for the receiving site to acknowledge." />}</section>
  </>
}

type MaintenanceRecord = { id: string; item_id: string; issue_description: string; priority: string; status: string; created_at: string }

function MaintenancePage({ items, profile, notify, onRefresh }: { items: InventoryItem[]; profile: Profile | null; notify: (notice: Notice) => void; onRefresh: () => void }) {
  const serviceItems = items.filter((item) => item.status === 'maintenance' || item.status === 'damaged')
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [showRequest, setShowRequest] = useState(false)
  const [selectedItem, setSelectedItem] = useState('')
  const [issue, setIssue] = useState('')
  const [priority, setPriority] = useState('normal')
  const [condition, setCondition] = useState('good')
  const [busy, setBusy] = useState(false)
  const canManage = profile?.role === 'administrator' || profile?.role === 'inventory_manager'
  const canRequest = canManage || profile?.role === 'site_supervisor' || profile?.role === 'equipment_custodian'
  const loadRecords = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('maintenance_records')
      .select('id, item_id, issue_description, priority, status, created_at')
      .order('created_at', { ascending: false })
    if (error) notify({ kind: 'error', text: error.message })
    else setRecords(data ?? [])
  }, [notify])
  useEffect(() => { void loadRecords() }, [loadRecords])
  async function submitRequest(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.from('maintenance_records').insert({ item_id: selectedItem, issue_description: issue.trim(), priority })
    setBusy(false)
    if (error) notify({ kind: 'error', text: error.message })
    else {
      notify({ kind: 'success', text: 'Maintenance request recorded.' })
      setIssue('')
      setSelectedItem('')
      setShowRequest(false)
      void loadRecords()
    }
  }
  async function updateMaintenance(record: MaintenanceRecord, nextStatus: 'approved' | 'in_progress' | 'completed') {
    if (!supabase || busy) return
    if (!window.confirm(`Confirm ${nextStatus.replace('_', ' ')} for ${items.find((item) => item.id === record.item_id)?.name ?? 'this equipment'}?\n${record.issue_description}`)) return
    setBusy(true)
    const { error } = await supabase.rpc('set_maintenance_status', {
      p_maintenance_id: record.id,
      p_status: nextStatus,
      p_condition: nextStatus === 'completed' ? condition : null,
      p_notes: null,
    })
    setBusy(false)
    if (error) notify({ kind: 'error', text: error.message })
    else {
      notify({ kind: 'success', text: `Maintenance ${nextStatus.replace('_', ' ')}.` })
      void loadRecords()
      onRefresh()
    }
  }
  return <>
    <PageHeading eyebrow="ASSET CARE" title="Maintenance" description="Keep equipment safe, reliable, and ready for the next job." action={canRequest ? <button className="button button-primary" onClick={() => setShowRequest((visible) => !visible)}><Plus size={16} /> Request maintenance</button> : undefined} />
    {showRequest && <form className="panel maintenance-request form-grid" onSubmit={(event) => void submitRequest(event)}><label className="form-field full"><span>Equipment asset <b>*</b></span><select required value={selectedItem} onChange={(event) => setSelectedItem(event.target.value)}><option value="">Choose an asset...</option>{items.filter((item) => item.tracking_type === 'asset' && item.status !== 'retired').map((item) => <option value={item.id} key={item.id}>{item.name} · {item.asset_tag ?? item.id.slice(0, 8)}</option>)}</select></label><label className="form-field full"><span>Issue description <b>*</b></span><input required value={issue} onChange={(event) => setIssue(event.target.value)} placeholder="Describe the repair or inspection needed" /></label><label className="form-field"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><div className="form-submit"><button type="button" className="button button-secondary" onClick={() => setShowRequest(false)}>Cancel</button><button className="button button-primary" disabled={!supabase || busy || !selectedItem}>{busy ? <LoaderCircle className="spin" size={15} /> : <Wrench size={15} />}Submit request</button></div></form>}
    <section className="panel maintenance-panel"><div className="panel-head"><div><h2>Maintenance requests</h2><p>Review, approve, and return assets to service after inspection.</p></div><span className="count-pill">{records.length} records</span></div>{records.length ? <div className="table-scroll"><table className="inventory-table"><thead><tr><th>EQUIPMENT</th><th>ISSUE</th><th>PRIORITY</th><th>STATUS</th><th>REPORTED</th><th /></tr></thead><tbody>{records.map((record) => { const item = items.find((candidate) => candidate.id === record.item_id); return <tr key={record.id}><td><strong>{item?.name ?? record.item_id.slice(0, 8)}</strong></td><td>{record.issue_description}</td><td><span className={`priority-chip ${record.priority}`}>{record.priority}</span></td><td><span className={`status-badge ${record.status === 'completed' ? 'green' : record.status === 'in_progress' ? 'orange' : 'gray'}`}><i />{record.status.replace('_', ' ')}</span></td><td>{formatDate(record.created_at)}</td><td className="maintenance-actions">{canManage && record.status === 'requested' && <button className="button button-secondary receive-button" disabled={busy} onClick={() => void updateMaintenance(record, 'approved')}>Approve</button>}{canManage && record.status === 'approved' && <button className="button button-secondary receive-button" disabled={busy} onClick={() => void updateMaintenance(record, 'in_progress')}>Start work</button>}{canManage && record.status === 'in_progress' && <button className="button button-secondary receive-button" disabled={busy} onClick={() => void updateMaintenance(record, 'completed')}>Complete</button>}</td></tr>})}</tbody></table></div> : <EmptyState icon={Wrench} title="No maintenance requests" description="New equipment repair and inspection requests will appear here." />}</section>
    {canManage && records.some((record) => record.status === 'in_progress') && <div className="maintenance-condition"><label className="form-field"><span>Condition after completed maintenance</span><select value={condition} onChange={(event) => setCondition(event.target.value)}><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor — remain unavailable</option><option value="damaged">Damaged — remain unavailable</option><option value="missing_parts">Missing parts — remain unavailable</option></select></label></div>}
    <section className="panel maintenance-panel service-assets"><div className="panel-head"><div><h2>Equipment requiring attention</h2><p>Assets marked for maintenance or inspection</p></div><span className="count-pill">{serviceItems.length} assets</span></div>{serviceItems.length ? <InventoryTable items={serviceItems} /> : <EmptyState icon={Wrench} title="No equipment needs attention" description="Equipment reported as damaged or scheduled for maintenance will appear here." />}</section><div className="maintenance-callout"><ShieldCheck size={18} /><div><strong>Safety first</strong><p>Only authorized inventory managers can return equipment from maintenance to service.</p></div></div>
  </>
}

type AuditRecord = { id: number; actor_id: string | null; action: string; table_name: string; record_id: string; created_at: string }

function ReportsPage({ items, profile, notify }: { items: InventoryItem[]; profile: Profile | null; notify: (notice: Notice) => void }) {
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([])
  const [auditError, setAuditError] = useState('')
  const canReadAudit = profile?.role === 'administrator' || profile?.role === 'viewer_auditor'
  useEffect(() => {
    if (!supabase || !canReadAudit) return
    void supabase.from('audit_logs').select('id, actor_id, action, table_name, record_id, created_at').order('created_at', { ascending: false }).limit(15)
      .then(({ data, error }) => {
        if (error) {
          setAuditError(error.message)
          notify({ kind: 'error', text: error.message })
        } else setAuditRecords(data ?? [])
      })
  }, [canReadAudit, notify])
  const totalValue = items.reduce((sum, item) => sum + Number(item.purchase_cost ?? 0) * (item.tracking_type === 'stock' ? Number(item.quantity) : 1), 0)
  const csv = () => {
    const values = [['Name', 'Asset tag', 'Type', 'Status', 'Location', 'Quantity', 'Purchase value'], ...items.map((item) => [item.name, item.asset_tag ?? '', item.tracking_type, item.status, item.location?.name ?? '', String(item.quantity ?? 1), String(item.purchase_cost ?? 0)])]
    const url = URL.createObjectURL(new Blob([values.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'asia-best-inventory-report.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return <><PageHeading eyebrow="INSIGHTS & EXPORTS" title="Reports" description="Export a current inventory register based on the records you’re allowed to access." action={<button className="button button-primary" onClick={csv}><Download size={16} /> Export CSV</button>} /><div className="report-grid"><div className="report-card"><span className="report-icon blue"><Boxes size={18} /></span><small>REGISTERED RECORDS</small><strong>{items.length.toLocaleString()}</strong><span>Visible to your account</span></div><div className="report-card"><span className="report-icon green"><Check size={18} /></span><small>AVAILABLE ASSETS</small><strong>{items.filter((item) => item.status === 'available').length.toLocaleString()}</strong><span>Ready to deploy</span></div><div className="report-card"><span className="report-icon orange"><CalendarDays size={18} /></span><small>ESTIMATED VALUE</small><strong>{formatCurrency(totalValue)}</strong><span>Based on purchase cost</span></div></div><div className="panel report-detail"><div className="panel-head"><div><h2>Inventory register</h2><p>Current data governed by your access permissions</p></div></div><InventoryTable items={items.slice(0, 10)} compact /></div>{canReadAudit && <div className="panel report-detail audit-panel"><div className="panel-head"><div><h2>Audit history</h2><p>Recent immutable events visible to your access scope</p></div><span className="count-pill">{auditRecords.length} events</span></div>{auditError ? <div className="inline-error">{auditError}</div> : auditRecords.length ? <div className="table-scroll"><table className="inventory-table"><thead><tr><th>EVENT</th><th>RECORD TYPE</th><th>RECORD ID</th><th>ACTOR ID</th><th>WHEN</th></tr></thead><tbody>{auditRecords.map((record) => <tr key={record.id}><td><span className="status-badge blue"><i />{record.action}</span></td><td>{record.table_name.replaceAll('_', ' ')}</td><td><span className="asset-code">{record.record_id}</span></td><td><span className="asset-code">{record.actor_id?.slice(0, 8) ?? 'System'}</span></td><td>{formatDate(record.created_at)}</td></tr>)}</tbody></table></div> : <EmptyInline text="No audit events are available in your scope yet." />}</div>}</>
}

function SettingsPage({ profile, configured }: { profile: Profile | null; configured: boolean }) {
  return <><PageHeading eyebrow="WORKSPACE" title="Settings" description="Review your account and workspace connection." /><div className="settings-grid"><div className="panel settings-card"><div className="settings-card-head"><span className="settings-icon"><ShieldCheck size={18} /></span><div><h2>Account access</h2><p>Identity and permission scope</p></div></div><div className="settings-row"><span>Signed-in user</span><strong>{profile?.full_name ?? (configured ? 'Not loaded' : 'Not connected')}</strong></div><div className="settings-row"><span>Assigned role</span><strong className="role-chip">{profile?.role?.replaceAll('_', ' ') ?? '—'}</strong></div><div className="settings-row"><span>Authorization</span><strong>{configured ? 'Supabase Auth + database RLS' : 'Not configured'}</strong></div></div><div className="panel settings-card"><div className="settings-card-head"><span className="settings-icon"><Building2 size={18} /></span><div><h2>Database connection</h2><p>Secure backend configuration</p></div></div><div className="connection-status"><span className={configured ? 'connection-dot connected' : 'connection-dot'} />{configured ? 'Supabase client configured' : 'Waiting for environment variables'}</div><p className="settings-help">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code>. Never put a service-role key in frontend configuration.</p></div></div></>
}

function NewItemModal({ onClose, onSaved, notify }: { onClose: () => void; onSaved: () => void; notify: (notice: Notice) => void }) {
  const [tracking, setTracking] = useState<'asset' | 'stock'>('asset')
  const [name, setName] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [quantity, setQuantity] = useState('1')
  const [minimumStock, setMinimumStock] = useState('0')
  const [unit, setUnit] = useState('unit')
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supabase) return
    void supabase.from('equipment_categories').select('id, name').order('name').then(({ data, error }) => {
      if (error) notify({ kind: 'error', text: error.message })
      else setCategories(data ?? [])
    })
  }, [notify])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) {
      notify({ kind: 'error', text: 'Connect Supabase to register inventory.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.from('inventory_items').insert({
      name: name.trim(),
      tracking_type: tracking,
      asset_tag: assetTag.trim() || null,
      status: 'available',
      quantity: tracking === 'stock' ? Number(quantity) : 1,
      unit: tracking === 'stock' ? unit : 'unit',
      minimum_stock: tracking === 'stock' ? Number(minimumStock) : 0,
      purchase_cost: cost ? Number(cost) : null,
      category_id: category.trim() || null,
    })
    setBusy(false)
    if (error) notify({ kind: 'error', text: error.message })
    else {
      notify({ kind: 'success', text: 'Inventory item registered.' })
      onSaved()
    }
  }
  return <Modal title="Add inventory" subtitle="Register equipment or bulk materials to your inventory." onClose={onClose}><form className="form-grid modal-form" onSubmit={(event) => void submit(event)}><label className="form-field full"><span>Item name <b>*</b></span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. 5kW portable generator" autoFocus /></label><label className="form-field"><span>Tracking method</span><select value={tracking} onChange={(event) => setTracking(event.target.value as 'asset' | 'stock')}><option value="asset">Individual asset</option><option value="stock">Quantity-based stock</option></select></label><label className="form-field"><span>Asset tag</span><input value={assetTag} onChange={(event) => setAssetTag(event.target.value)} placeholder="e.g. GEN-0248" /></label><label className="form-field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Uncategorized</option>{categories.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>{tracking === 'stock' && <><label className="form-field"><span>Initial quantity <b>*</b></span><input type="number" min="0" step="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label className="form-field"><span>Unit of measurement</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="e.g. bag, kg, box" /></label><label className="form-field"><span>Low-stock threshold</span><input type="number" min="0" step="0.001" value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} /></label></>}<label className="form-field full"><span>Purchase cost (optional)</span><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="0.00" /></label><div className="form-note full"><QrCode size={16} /><span>Each inventory record gets a unique QR identity that can be printed from the inventory list.</span></div><div className="full modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !supabase}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Register item</button></div></form></Modal>
}

function Login({ onNotify, notice }: { onNotify: (notice: Notice) => void; notice: Notice | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  async function login(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) onNotify({ kind: 'error', text: error.message })
  }
  return <div className="login-shell"><div className="login-panel"><div className="brand login-brand"><div className="brand-mark"><HardHat size={21} /></div><div className="brand-copy"><strong className="brand-main">Asia Best</strong><span className="brand-subline">Construction and Development<br />Corporation</span><small>Equipment Tracker</small></div></div><div className="login-copy"><div className="eyebrow">EQUIPMENT TRACKER</div><h1>Welcome back.</h1><p>Sign in to see what’s moving across your sites today.</p></div><form className="login-form" onSubmit={(event) => void login(event)}><label className="form-field"><span>Email address</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="username" /></label><label className="form-field"><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" /></label><button className="button button-primary login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : null}Sign in to Equipment Tracker</button></form><div className="login-secure"><ShieldCheck size={15} /> Secure access managed by your organization</div>{notice && <div className={`login-notice ${notice.kind}`}>{notice.text}</div>}</div><div className="login-art"><div className="art-grid" /><div className="art-content"><span className="art-overline">ASIA BEST · FIELD OPERATIONS</span><h2>Every asset has<br />a story. <span>Know yours.</span></h2><p>One clear view of the equipment, materials, and movement keeping every project on track.</p><div className="art-card"><div className="art-card-top"><span><span className="art-dot" /> SITE ACTIVITY</span><span>LIVE</span></div><div className="art-movement"><span className="art-movement-icon"><ArrowLeftRight size={16} /></span><div><strong>Equipment movement</strong><small>Equipment records are secured by your project access.</small></div></div></div></div><span className="art-footer">ASIA BEST CONSTRUCTION AND DEVELOPMENT CORPORATION</span></div></div>
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>{children}</section></div>
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Boxes; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={21} /></div><strong>{title}</strong><p>{description}</p>{action}</div>
}

function EmptyInline({ text }: { text: string }) {
  return <div className="empty-inline"><MapPin size={18} /><span>{text}</span></div>
}

function LoadingState() {
  return <div className="loading-state"><LoaderCircle className="spin" size={22} />Loading inventory…</div>
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export default App
