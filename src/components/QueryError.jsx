export function QueryError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <p className="text-danger text-sm font-mono">Error: {message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-accent hover:text-accent/80 border border-accent/30 hover:border-accent/50 px-3 py-1.5 rounded transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
