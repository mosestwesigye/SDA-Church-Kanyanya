/** Empty / error / loading states shared by every list and screen. */

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {children && <div className="text-ink-2 mt-2 max-w-md mx-auto">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", children, action }: { title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="alert" className="card p-8 text-center border-error/40">
      <h2 className="text-[17px] font-semibold text-error">{title}</h2>
      {children && <div className="text-ink-2 mt-2 max-w-md mx-auto">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card p-5 space-y-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <div className="skeleton size-8 rounded-full" />
          <div className="skeleton h-4 flex-1" />
          <div className="skeleton h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
