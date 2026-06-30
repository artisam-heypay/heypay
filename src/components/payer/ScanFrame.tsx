import type { ReactNode } from "react";

// Framed square viewport with corner brackets + an animated scan line.
export function ScanFrame({
  children,
  scanning = true,
}: {
  children: ReactNode;
  scanning?: boolean;
}) {
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl border-2 border-primary/30 bg-surface-container-low">
      {children}
      {/* corner brackets */}
      <span className="pointer-events-none absolute left-3 top-3 h-6 w-6 rounded-tl-lg border-l-2 border-t-2 border-primary" />
      <span className="pointer-events-none absolute right-3 top-3 h-6 w-6 rounded-tr-lg border-r-2 border-t-2 border-primary" />
      <span className="pointer-events-none absolute bottom-3 left-3 h-6 w-6 rounded-bl-lg border-b-2 border-l-2 border-primary" />
      <span className="pointer-events-none absolute bottom-3 right-3 h-6 w-6 rounded-br-lg border-b-2 border-r-2 border-primary" />
      {scanning && (
        <div className="pointer-events-none absolute inset-x-0 h-0.5 bg-primary/70 animate-scan" />
      )}
    </div>
  );
}
