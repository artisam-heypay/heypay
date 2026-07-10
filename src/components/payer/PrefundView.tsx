"use client";
import { useState } from "react";
import { dec } from "@/lib/money";
import { MoneyAmount } from "@/components/ui";
import { AssetPicker } from "./AssetPicker";
import { DepositCard } from "./DepositCard";
import { PendingDepositWatcher } from "./PendingDepositWatcher";

export type PrefundAsset = {
  asset: string;
  /** Cached balance, 7dp string. */
  balance: string;
  /** Approximate PHP value of `balance`, 2dp string. Null when no rate exists. */
  approxPhp: string | null;
  /** Issued assets need a trustline before the wallet can receive them. */
  trustlineRequired: boolean;
  canReceive: boolean;
  /** Issuer account this asset must come from; null for native XLM. */
  issuer: string | null;
};

/**
 * Owns which asset the payer is funding. Balance, deposit instructions and the
 * incoming-deposit watcher all follow that one choice, so the number on screen
 * always matches the address underneath it.
 */
export function PrefundView({
  publicKey,
  qrSvg,
  assets,
}: {
  publicKey: string;
  qrSvg: string;
  assets: PrefundAsset[];
}) {
  const [selected, setSelected] = useState(assets[0]?.asset ?? "XLM");
  const [trustlines, setTrustlines] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(assets.map((a) => [a.asset, a.canReceive])),
  );

  const current = assets.find((a) => a.asset === selected) ?? assets[0];
  if (!current) return null;

  return (
    <>
      <AssetPicker
        label="Prefund with"
        options={assets.map((a) => ({
          asset: a.asset,
          balance: `${a.balance} ${a.asset}`,
          canReceive: trustlines[a.asset] ?? a.canReceive,
        }))}
        value={selected}
        onChange={setSelected}
      />

      <div>
        <p className="text-label-md uppercase text-on-surface-variant">{current.asset} Balance</p>
        <MoneyAmount
          xlm={dec(current.balance)}
          asset={current.asset}
          php={current.approxPhp === null ? null : dec(current.approxPhp)}
          size="display"
        />
      </div>

      <PendingDepositWatcher asset={current.asset} initialBalance={current.balance} />

      <DepositCard
        publicKey={publicKey}
        qrSvg={qrSvg}
        asset={current.asset}
        issuer={current.issuer}
        trustlineRequired={current.trustlineRequired}
        canReceive={trustlines[current.asset] ?? current.canReceive}
        onTrustlineEstablished={() => setTrustlines((prev) => ({ ...prev, [current.asset]: true }))}
      />
    </>
  );
}
