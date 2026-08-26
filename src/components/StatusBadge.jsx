const STATUS_STYLES = {
  // open_pos statuses
  'Pending Receipt':                     'bg-amber-500/15 text-amber-400',
  'Partially Received':                  'bg-blue-500/15 text-blue-400',
  'Fully Billed':                        'bg-success/10 text-success',
  'Closed':                              'bg-success/10 text-success',
  'Pending Bill':                        'bg-amber-500/15 text-amber-400',
  'Pending Billing/Partially Received':  'bg-blue-500/15 text-blue-400',
  // po_history statuses
  Open:       'bg-accent/10 text-accent',
  Received:   'bg-success/10 text-success',
  Partial:    'bg-warning/10 text-warning',
  Cancelled:  'bg-muted/20 text-muted',
  Pending:    'bg-warning/10 text-warning',
  // sales_pipeline deal stages
  'Contract & Negotiation': 'bg-accent/10 text-accent',
  'PO & $$$':               'bg-blue-500/15 text-blue-400',
  'Closed won':             'bg-success/10 text-success',
  'Closed lost':            'bg-danger/10 text-danger',
};

export function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? 'bg-white/10 text-white/60';
  return (
    <span
      title={status}
      className={`inline-block max-w-full truncate align-middle whitespace-nowrap text-[10px] sm:text-xs font-mono px-1.5 sm:px-2 py-0.5 rounded ${style}`}
    >
      {status}
    </span>
  );
}
