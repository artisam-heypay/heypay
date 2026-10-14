"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Switches which wallet the payer's payments come from, then draws the page
 * again for it. Nothing moves between the wallets: each keeps its balance.
 */
export function WalletModeButton({
  to,
  children,
}: {
  to: "CUSTODIAL" | "EXTERNAL";
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchWallet() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet/external", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletMode: to }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Could not switch wallets. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-stack-sm">
      <Button size="md" variant="outline-pill" onClick={switchWallet} loading={busy}>
        {children}
      </Button>
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
