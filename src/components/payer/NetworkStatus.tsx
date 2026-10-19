/** A compact chip naming the network, short enough to sit beside a page title on a phone. */
export function NetworkStatus({ network = "Stellar Testnet" }: { network?: string }) {
  const short = network.replace(/^Stellar\s+/, "");
  return (
    <span className="inline-flex shrink-0 items-center gap-stack-sm whitespace-nowrap rounded-full bg-surface-container px-3 py-1 text-body-sm text-on-surface-variant">
      <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{network}</span>
      <span className="sr-only">, connected</span>
    </span>
  );
}
