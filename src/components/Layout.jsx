import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { LogoMark } from './Logo';
import { Icon } from './icons';

// Menú agrupado por área de trabajo. `section: null` va arriba, sin título.
// El orden dentro de cada grupo es "lo que más se abre, primero".
const NAV_SECTIONS = [
  { section: null, items: [
    { to: '/',            label: 'Dashboard',       icon: 'dashboard' },
  ]},
  { section: 'Planning', items: [
    { to: '/forecast',    label: 'Demand Forecast', icon: 'forecast' },
    { to: '/item',        label: 'Item Forecast',   icon: 'search' },
    { to: '/reorder',     label: 'Reorder Alerts',  icon: 'alert' },
  ]},
  { section: 'Inventory', items: [
    { to: '/locations',   label: 'By Location',     icon: 'pin' },
    { to: '/trends',      label: 'Inventory Trends', icon: 'trend' },
    { to: '/open-transfer-orders', label: 'Transfer Orders', icon: 'swap' },
  ]},
  { section: 'Purchasing', items: [
    { to: '/on-order',    label: 'On Order',        icon: 'box' },
    { to: '/po-history',  label: 'PO History',      icon: 'clipboard' },
    { to: '/lead-times',  label: 'Lead Times',      icon: 'clock' },
  ]},
  { section: 'Sales', items: [
    { to: '/backlog',     label: 'Open Sales Orders', icon: 'receipt' },
    { to: '/so-history',  label: 'SO History',      icon: 'archive' },
    { to: '/pepsi',       label: 'PepsiCo',         icon: 'flag' },
    { to: '/sales-pipeline', label: 'Sales Pipeline', icon: 'dollar' },
    { to: '/margins',     label: 'Margins',         icon: 'percent' },
    { to: '/distributor-stock', label: 'Distributor Stock', icon: 'store' },
    { to: '/distributor-scorecard', label: 'Distributor Scorecard', icon: 'calc' },
  ]},
  { section: 'Support', items: [
    { to: '/serials',     label: 'Serial Numbers',  icon: 'hash' },
  ]},
];

// Accesos fijos de la tab bar inferior (mobile). El resto vive en "More".
const TABS = [
  { to: '/',           label: 'Home',    icon: 'dashboard' },
  { to: '/backlog',    label: 'Orders',  icon: 'receipt' },
  { to: '/so-history', label: 'History', icon: 'archive' },
  { to: '/reorder',    label: 'Reorder', icon: 'alert' },
];

// Hoja inferior (bottom sheet) con el menú completo, para mobile.
function MoreSheet({ open, onClose }) {
  // bloquear el scroll del body mientras está abierta
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <div className={`fixed inset-0 z-40 lg:hidden ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* Fondo */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* Hoja */}
      <div
        className={`absolute inset-x-0 bottom-0 max-h-[82dvh] flex flex-col rounded-t-2xl bg-[#111c28] border-t border-white/[0.08]
          shadow-[0_-16px_48px_rgba(0,0,0,0.55)] transition-transform duration-300 ease-out
          ${open ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex items-center justify-between px-5 pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-white/20 absolute left-1/2 -translate-x-1/2 top-2" />
          <span className="text-sm font-sans font-semibold text-white pt-2">Menu</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-2 -mr-2 mt-1 rounded-full text-slate-400 active:bg-white/[0.08] transition-colors"
          >
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
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
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3.5 px-3 py-3 rounded-xl text-[15px] font-sans transition-colors select-none ${
                      isActive ? 'bg-accent/10 text-accent' : 'text-slate-300 active:bg-white/[0.06]'
                    }`}
                >
                  <Icon name={icon} className="w-[22px] h-[22px]" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="mt-4 pt-3 border-t border-white/[0.08]">
            <button
              onClick={() => supabase.auth.signOut()}
              className="w-full flex items-center gap-3.5 px-3 py-3 rounded-xl text-[15px] font-sans text-slate-400 active:bg-white/[0.06] transition-colors select-none"
            >
              <Icon name="signout" className="w-[22px] h-[22px]" />
              Sign out
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

// Tab bar inferior fija (mobile). Blur + safe area, como una app nativa.
function TabBar({ onMore, moreOpen }) {
  const location = useLocation();
  const enTabs = TABS.some(t => (t.to === '/' ? location.pathname === '/' : location.pathname.startsWith(t.to)));
  const itemClass = act =>
    `flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 select-none transition-colors ${
      act ? 'text-accent' : 'text-slate-500 active:text-slate-300'
    }`;
  return (
    <div
      className="fixed bottom-0 inset-x-0 z-30 lg:hidden border-t border-white/[0.08]
        bg-[#0d1620]/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
    >
      <nav className="grid grid-cols-5">
        {TABS.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => itemClass(isActive && !moreOpen)}>
            {({ isActive }) => (
              <>
                <Icon name={icon} className="w-6 h-6" strokeWidth={isActive && !moreOpen ? 2.1 : 1.7} />
                <span className={`text-[10px] font-sans ${isActive && !moreOpen ? 'font-semibold' : 'font-medium'}`}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button onClick={onMore} className={itemClass(moreOpen || !enTabs)}>
          <Icon name="more" className="w-6 h-6" strokeWidth={moreOpen || !enTabs ? 2.1 : 1.7} />
          <span className={`text-[10px] font-sans ${moreOpen || !enTabs ? 'font-semibold' : 'font-medium'}`}>More</span>
        </button>
      </nav>
    </div>
  );
}

export function Layout() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // al navegar, cerrar la hoja y volver arriba
  useEffect(() => { setMoreOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded text-sm font-sans transition-colors ${
      isActive
        ? 'bg-accent/10 text-accent'
        : 'text-slate-400 hover:text-white hover:bg-white/5'
    }`;

  return (
    <div className="flex min-h-screen bg-[#0f1923]">
      {/* Sidebar — solo desktop; en mobile la navegación vive en la tab bar */}
      <aside className="hidden lg:flex static w-56 flex-col bg-[#0d1620] border-r border-white/[0.08]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-white/[0.08]">
          <LogoMark className="w-6 h-6 text-white" />
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
                <NavLink key={to} to={to} end={to === '/'} className={navLinkClass}>
                  <Icon name={icon} className="w-[18px] h-[18px]" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-white/[0.08] space-y-3">
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
        {/* Topbar mobile: logo + título + refresh (en modo app no hay botón de recarga) */}
        <header className="lg:hidden sticky top-0 z-20 flex items-center gap-3 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] border-b border-white/[0.08] bg-[#0d1620]/85 backdrop-blur-xl">
          <LogoMark className="w-5 h-5 text-white shrink-0" />
          <span className="font-sans font-semibold text-white text-[15px] tracking-wide truncate">
            Inventory
          </span>
          <button
            onClick={() => window.location.reload()}
            aria-label="Refresh"
            className="ml-auto p-2 -mr-2 rounded-full text-slate-400 active:bg-white/[0.08] active:text-white transition-colors"
          >
            <Icon name="refresh" className="w-5 h-5" />
          </button>
        </header>

        <main className="flex-1 p-4 lg:p-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      <TabBar onMore={() => setMoreOpen(v => !v)} moreOpen={moreOpen} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  );
}
