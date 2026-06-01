import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';

const NAV = [
  { to: '/',            label: 'Dashboard',     icon: '⬛' },
  { to: '/forecast',    label: 'Demand Forecast', icon: '📈' },
  { to: '/locations',   label: 'By Location',   icon: '📍' },
  { to: '/po-history',  label: 'PO History',    icon: '📋' },
  { to: '/reorder',     label: 'Reorder Alerts', icon: '🔴' },
];

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
        <div className="flex items-center gap-2 px-4 py-5 border-b border-white/[0.08]">
          <div className="w-6 h-6 bg-accent rounded flex items-center justify-center">
            <span className="text-white font-bold text-xs font-mono">RW</span>
          </div>
          <span className="font-sans font-semibold text-white text-sm tracking-wide">
            Inventory
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, label, icon }) => (
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
        </nav>

        <div className="px-4 py-4 border-t border-white/[0.08]">
          <p className="text-[10px] text-muted font-mono uppercase tracking-widest">
            realwear.com
          </p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-white/[0.08] bg-[#0d1620]">
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

        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
