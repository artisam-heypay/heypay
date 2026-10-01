import type { ReactNode } from "react";

export function ScanFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl border-2 border-primary/30 bg-surface-container">
      {children}
      {/* corner brackets */}
      <span
        aria-hidden
        className="absolute left-2 top-2 h-6 w-6 border-l-2 border-t-2 border-primary"
      />
      <span
        aria-hidden
        className="absolute right-2 top-2 h-6 w-6 border-r-2 border-t-2 border-primary"
      />
      <span
        aria-hidden
        className="absolute bottom-2 left-2 h-6 w-6 border-b-2 border-l-2 border-primary"
      />
      <span
        aria-hidden
        className="absolute bottom-2 right-2 h-6 w-6 border-b-2 border-r-2 border-primary"
      />
      {/* animated scan line (decorative; disabled under reduced-motion) */}
      <div aria-hidden className="animate-scan absolute inset-x-0 h-0.5 bg-primary/70" />
    </div>
  );
}
