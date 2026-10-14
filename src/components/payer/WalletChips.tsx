import { clsx } from "clsx";
import { Icon } from "@/components/ui";

const chip = "inline-flex items-center gap-1 rounded-full px-3 py-1 text-label-md uppercase";

/** Marks the wallet the payer's payments come from. */
export function PaysNowChip() {
  return <span className={clsx(chip, "bg-primary text-on-primary")}>Pays now</span>;
}

/**
 * Who holds the wallet's key: the payer (their own wallet) or HeyPay (the
 * HeyPay wallet). The two are never added together, because who can move the
 * money differs.
 */
export function CustodyChip({ holder }: { holder: "you" | "heypay" }) {
  return (
    <span className={clsx(chip, "bg-surface-container-high text-on-surface-variant")}>
      <Icon name="key" className="text-base" />
      {holder === "you" ? "You hold the key" : "HeyPay holds the key"}
    </span>
  );
}
