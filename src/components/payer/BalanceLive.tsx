"use client";
import { useEffect, useState } from "react";
import { dec } from "@/lib/money";
import { MoneyAmount } from "@/components/ui";

// Polls GET /api/wallet so the hero balance stays fresh. It's a data update, not a
// decorative animation — reduced-motion safe.
export function BalanceLive({
  initialXlm,
  initialPhp,
}: {
  initialXlm: string;
  initialPhp: string;
}) {
  const [xlm, setXlm] = useState(initialXlm);
  const [php, setPhp] = useState(initialPhp);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch("/api/wallet", { signal: ctrl.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { availableXlm?: string; approxPhp?: string };
        if (body.availableXlm) setXlm(body.availableXlm);
        if (body.approxPhp) setPhp(body.approxPhp);
      } catch {
        // network blip / aborted → keep the last known balance
      }
    };
    const id = setInterval(load, 15_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      ctrl.abort();
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return <MoneyAmount size="display" xlm={dec(xlm)} php={dec(php)} />;
}
