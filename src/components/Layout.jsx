import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Menú agrupado por área de trabajo. `section: null` va arriba, sin título.
// El orden dentro de cada grupo es "lo que más se abre, primero".
const NAV_SECTIONS = [
  { section: null, items: [
    { to: '/',            label: 'Dashboard',       icon: '⬛' },
  ]},
  { section: 'Planning', items: [
    { to: '/forecast',    label: 'Demand Forecast', icon: '📈' },
    { to: '/item',        label: 'Item Forecast',   icon: '🔍' },
    { to: '/reorder',     label: 'Reorder Alerts',  icon: '🔴' },
  ]},
  { section: 'Inventory', items: [
    { to: '/locations',   label: 'By Location',     icon: '📍' },
    { to: '/trends',      label: 'Inventory Trends', icon: '📉' },
    { to: '/open-transfer-orders', label: 'Transfer Orders', icon: '🔁' },
  ]},
  { section: 'Purchasing', items: [
    { to: '/on-order',    label: 'On Order',        icon: '📦' },
    { to: '/po-history',  label: 'PO History',      icon: '📋' },
    { to: '/lead-times',  label: 'Lead Times',      icon: '⏱️' },
  ]},
  { section: 'Sales', items: [
    { to: '/backlog',     label: 'Open Sales Orders', icon: '🧾' },
    { to: '/so-history',  label: 'SO History',      icon: '🗂️' },
    { to: '/sales-pipeline', label: 'Sales Pipeline', icon: '💰' },
    { to: '/margins',     label: 'Margins',         icon: '💹' },
    { to: '/distributor-stock', label: 'Distributor Stock', icon: '🏬' },
    { to: '/distributor-scorecard', label: 'Distributor Scorecard', icon: '🧮' },
  ]},
  { section: 'Support', items: [
    { to: '/serials',     label: 'Serial Numbers',  icon: '🔢' },
  ]},
];

// Lista plana para el título del topbar en mobile.
const NAV = NAV_SECTIONS.flatMap(s => s.items);

function NavIcon({ icon }) {
  return <span className="w-4 h-4 text-base leading-none select-none">{icon}</span>;
}

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded text-sm font-sans transition-colors ${
      isActive
        ? 'bg-accent/10 text-accent'
        : 'text-slate-400 hover:text-white hover:bg-white/5'
    }`;

  return (
    <div className="flex min-h-screen bg-[#0f1923]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-30 h-full w-56 flex flex-col bg-[#0d1620] border-r border-white/[0.08]
          transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:translate-x-0 lg:z-auto
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top))] border-b border-white/[0.08]">
          <div className="w-6 h-6 bg-accent rounded flex items-center justify-center">
            <span className="text-white font-bold text-xs font-mono">RW</span>
          </div>
          <span className="font-sans font-semibold text-white text-sm tracking-wide">
            Inventory
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_SECTIONS.map(({ section, items }) => (
            <div key={section ?? 'top'}>
              {section && (
                <p className="px-3 pt-4 pb-1 text-[10px] text-muted font-mono uppercase tracking-widest select-none">
                  {section}
                </p>
              )}
              {items.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={navLinkClass}
                  onClick={() => setSidebarOpen(false)}
                >
                  <NavIcon icon={icon} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-white/[0.08] space-y-3">
          <p className="text-[10px] text-muted font-mono uppercase tracking-widest">
            realwear.com
          </p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full text-left text-xs text-slate-500 hover:text-slate-300 font-sans transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <header className="lg:hidden sticky top-0 z-10 flex items-center gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-white/[0.08] bg-[#0d1620]">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-400 hover:text-white p-1"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-sans font-semibold text-white text-sm">
            {NAV.find(n => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)))?.label ?? 'Inventory'}
          </span>
        </header>

        <main className="flex-1 p-4 lg:p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
