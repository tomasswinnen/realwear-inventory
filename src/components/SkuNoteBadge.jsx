export function SkuNoteBadge({ noteData }) {
  if (!noteData) return null;
  const prefix = noteData.note?.split(' — ')[0]?.trim() ?? '';
  const statusLabel = noteData.status
    ? noteData.status[0].toUpperCase() + noteData.status.slice(1)
    : '';
  const label = prefix && statusLabel ? `${prefix} · ${statusLabel}` : statusLabel || prefix;
  if (!label) return null;
  return (
    <span
      title={noteData.note ?? label}
      className="inline-block max-w-[170px] truncate align-middle text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 whitespace-nowrap"
    >
      {label}
    </span>
  );
}
