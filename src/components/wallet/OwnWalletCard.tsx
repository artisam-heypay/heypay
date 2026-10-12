"use client";
import { useState } from "react";
import { Button, Card, Icon } from "@/components/ui";
import { connectFreighter } from "./freighter";

type WalletMode = "CUSTODIAL" | "EXTERNAL";
type OwnWallet = { walletMode: WalletMode; externalPublicKey: string | null };

/** GABC…WXYZ: enough to recognise an account without filling a phone screen. */
function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Lets a payer connect their own wallet (Freighter) and choose whether their
 * payments are signed with it or with the HeyPay wallet. HeyPay is only told
 * the account's address; the key stays in Freighter.
 */
export function OwnWalletCard({
  walletMode,
  externalPublicKey,
  networkPassphrase,
  networkName,
}: OwnWallet & {
  /** The network HeyPay runs on; Freighter must be on the same one. */
  networkPassphrase: string;
  networkName: string;
}) {
  // The props are what was saved at page load; a change made here replaces them.
  const [wallet, setWallet] = useState<OwnWallet>({ walletMode, externalPublicKey });
  const [busy, setBusy] = useState<"connect" | "mode" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(method: "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<void> {
    try {
      const res = await fetch("/api/wallet/external", {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const data = (await res.json().catch(() => null)) as
        (Partial<OwnWallet> & { error?: { message?: string } }) | null;
      if (!res.ok || !data?.walletMode) {
        setError(data?.error?.message ?? "Could not save your wallet. Try again.");
        return;
      }
      setWallet({ walletMode: data.walletMode, externalPublicKey: data.externalPublicKey ?? null });
    } catch {
      setError("Network error. Try again.");
    }
  }

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      const freighter = await connectFreighter({ networkPassphrase, networkName });
      if (!freighter.ok) {
        setError(freighter.message);
        return;
      }
      await save("PUT", { publicKey: freighter.address });
    } catch {
      setError("Could not reach Freighter. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function setMode(next: WalletMode) {
    setBusy("mode");
    setError(null);
    await save("PATCH", { walletMode: next });
    setBusy(null);
  }

  async function disconnect() {
    setBusy("disconnect");
    setError(null);
    await save("DELETE");
    setBusy(null);
  }

  const address = wallet.externalPublicKey;
  const useOwn = wallet.walletMode === "EXTERNAL";

  return (
    <Card className="flex flex-col gap-stack-md">
      <h2 className="font-display text-headline-md">Your own wallet</h2>
      <p className="text-body-md">
        Pay from a wallet you hold the key to. You approve each payment in Freighter, and HeyPay
        never sees your key.
      </p>

      {address ? (
        <>
          <p className="flex flex-wrap items-center gap-stack-sm text-body-md text-primary">
            <Icon name="check_circle" filled />
            Connected
            <span className="font-mono text-on-surface" title={address}>
              {shortAddress(address)}
            </span>
          </p>
          <div className="flex items-center justify-between gap-stack-md">
            <span id="own-wallet-label" className="text-body-md">
              Use my own wallet
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={useOwn}
              aria-labelledby="own-wallet-label"
              disabled={busy !== null}
              onClick={() => setMode(useOwn ? "CUSTODIAL" : "EXTERNAL")}
              className={
                "relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none " +
                "focus:ring-4 focus:ring-primary/10 disabled:opacity-60 " +
                (useOwn ? "bg-primary" : "bg-outline-variant")
              }
            >
              <span
                aria-hidden
                className={
                  "absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform " +
                  (useOwn ? "translate-x-5" : "translate-x-0")
                }
              />
            </button>
          </div>
          <p className="text-body-sm text-on-surface-variant">
            {useOwn
              ? "Payments are signed in Freighter."
              : "Payments are signed with your HeyPay wallet."}
          </p>
          <Button
            type="button"
            variant="outline-pill"
            size="md"
            onClick={disconnect}
            loading={busy === "disconnect"}
            disabled={busy !== null}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="md"
          onClick={connect}
          loading={busy === "connect"}
          trailingIcon="account_balance_wallet"
        >
          {busy === "connect" ? "Connecting…" : "Connect Freighter"}
        </Button>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
    </Card>
  );
}
