import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { displayAsset } from "@/lib/money";
import { stellarTxUrl } from "@/lib/stellar-explorer";
import { getWalletSummary } from "@/server/payer/data";
import { getRecentSwaps, swapsAvailable } from "@/server/payer/swap";
import { walletService } from "@/server/stellar/wallet";
import { Card } from "@/components/ui";
import { SwapPanel } from "@/components/payer/SwapPanel";

function formatDate(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function PayerSwapPage() {
  const user = await requireRole(Role.PAYER);
  const wallet = swapsAvailable() ? await getWalletSummary(user.id) : null;

  if (!wallet) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-stack-lg">
        <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Swap</h1>
        <Card>
          <p className="text-body-md">Swaps are not available right now.</p>
        </Card>
      </div>
    );
  }

  const usdc = wallet.balances.find((b) => b.asset === "USDC");
  // Whether USDC is on is the chain's answer; the cached flag stands in only
  // when Horizon is unreachable.
  let usdcOn = usdc?.canReceive ?? false;
  try {
    usdcOn = await walletService.canReceive(wallet.publicKey, "USDC");
  } catch {
    // Horizon down: keep the cached flag.
  }
  const available = (asset: "XLM" | "USDC") =>
    wallet.balances.find((b) => b.asset === asset)?.available.toFixed(7) ?? "0.0000000";
  const swaps = await getRecentSwaps(user.id);
  const network = process.env.STELLAR_NETWORK;
  const testnet = network !== "mainnet" && network !== "public";

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Swap</h1>
      <SwapPanel
        balances={{ XLM: available("XLM"), USDC: available("USDC") }}
        usdcOn={usdcOn}
        testnet={testnet}
        trustlineTxUrl={usdc?.trustlineTxHash ? stellarTxUrl(usdc.trustlineTxHash) : null}
      />

      <Card>
        <h2 className="font-display text-headline-md">Recent swaps</h2>
        {swaps.length === 0 ? (
          <p className="mt-stack-md text-body-md text-on-surface-variant">No swaps yet.</p>
        ) : (
          <ul className="mt-stack-md divide-y divide-outline-variant">
            {swaps.map((s) => (
              <li
                key={s.txHash}
                className="flex flex-wrap items-center justify-between gap-x-stack-md gap-y-1 py-stack-md"
              >
                <div className="min-w-0">
                  <p className="font-mono text-mono-data">
                    {displayAsset(s.sent, s.from)}
                    {s.received && s.to && ` → ${displayAsset(s.received, s.to)}`}
                  </p>
                  <p className="text-body-sm text-on-surface-variant">{formatDate(s.createdAt)}</p>
                </div>
                <a
                  href={stellarTxUrl(s.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center rounded text-body-sm text-primary underline focus:outline-none focus:ring-4 focus:ring-primary/10"
                >
                  View transaction
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
