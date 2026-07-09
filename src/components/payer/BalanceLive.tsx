"use client";
import { useEffect, useState } from "react";
import { dec } from "@/lib/money";
import { MoneyAmount } from "@/components/ui";

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
    const controller = new AbortController();
    async function refresh() {
      try {
        const res = await fetch("/api/wallet", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { availableXlm: string; approxPhp: string };
        setXlm(data.availableXlm);
        // approxPhp is a display string like "₱1,234.50"; strip non-numeric for Decimal.
        setPhp(data.approxPhp.replace(/[^0-9.]/g, "") || "0");
      } catch {
        // network/abort — keep the last known value
      }
    }
    const id = setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      clearInterval(id);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return <MoneyAmount xlm={dec(xlm)} php={dec(php)} size="display" />;
}
