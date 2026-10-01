import { Icon } from "@/components/ui";

export function NetworkStatus({ network = "Stellar Testnet" }: { network?: string }) {
  return (
    <div className="flex items-center gap-stack-sm text-body-sm text-on-surface-variant">
      <Icon name="hub" />
      <span>{network}</span>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
      <span className="text-primary">Connected</span>
    </div>
  );
}
