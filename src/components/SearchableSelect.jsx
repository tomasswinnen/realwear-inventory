import { useState, useRef, useEffect, useId } from 'react';

/**
 * Searchable combobox dropdown.
 *
 * Options shape: { value: string, label: string, description?: string }
 * The search matches against both label and description.
 * The dropdown shows label as primary text and description as a muted second line.
 */
export function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  clearable = false,
  clearLabel = 'All',
  className = '',
  inputClass = '',
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Sync display text with selected value when closed
  useEffect(() => {
    if (!open) {
      const selected = options.find(o => o.value === value);
      setQuery(selected ? selected.label : '');
    }
  }, [value, open, options]);

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q === ''
    ? options
    : options.filter(o =>
        o.label.toLowerCase().includes(q) ||
        (o.description ?? '').toLowerCase().includes(q)
      );

  function handleSelect(optValue) {
    onChange(optValue);
    setOpen(false);
  }

  function handleInputChange(e) {
    setQuery(e.target.value);
    setOpen(true);
  }

  function handleFocus() {
    setQuery('');
    setOpen(true);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Enter' && filtered.length === 1) {
      handleSelect(filtered[0].value);
    }
  }

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className="flex items-center rounded-lg overflow-hidden"
        style={{ background: '#0d1a27', border: '1px solid rgba(148,163,184,0.15)' }}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={open ? query : selectedLabel}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`flex-1 bg-transparent px-3 py-2.5 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none min-w-0 ${inputClass}`}
        />
        <button
          tabIndex={-1}
          onMouseDown={e => {
            e.preventDefault();
            if (open) setOpen(false);
            else inputRef.current?.focus();
          }}
          className="px-2 py-2.5 text-slate-500 hover:text-slate-300 transition-colors shrink-0"
          aria-label="Toggle dropdown"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg overflow-y-auto"
          style={{
            background: '#0d1a27',
            border: '1px solid rgba(148,163,184,0.18)',
            maxHeight: 280,
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
        >
          {clearable && (
            <button
              className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors ${
                value === ''
                  ? 'text-accent bg-accent/10'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
              onMouseDown={e => { e.preventDefault(); handleSelect(''); }}
            >
              {clearLabel}
            </button>
          )}

          {filtered.length === 0 ? (
            <div className="px-3 py-2.5 text-xs font-mono text-slate-600">No matches</div>
          ) : (
            filtered.map(opt => (
              <button
                key={opt.value}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  opt.value === value ? 'bg-accent/10' : 'hover:bg-white/[0.05]'
                }`}
                onMouseDown={e => { e.preventDefault(); handleSelect(opt.value); }}
              >
                <span className={`block text-sm font-mono leading-snug ${opt.value === value ? 'text-accent' : 'text-slate-200'}`}>
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="block text-[11px] font-sans text-slate-500 leading-snug mt-0.5 truncate">
                    {opt.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
