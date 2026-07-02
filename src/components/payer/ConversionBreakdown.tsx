import { Card, MoneyAmount } from "@/components/ui";
import { type Decimal, displayPhp, displayXlm, formatPhp } from "@/lib/money";

export function ConversionBreakdown({
  amountPhp,
  quotedRate,
  amountXlm,
  networkFeeXlm,
}: {
  amountPhp: Decimal;
  quotedRate: Decimal;
  amountXlm: Decimal;
  networkFeeXlm: Decimal;
}) {
  const total = amountXlm.plus(networkFeeXlm);
  return (
    <Card>
      <p className="text-label-md uppercase text-on-surface-variant">You pay</p>
      <p className="font-display text-headline-lg text-on-surface">{displayPhp(amountPhp)}</p>

      <dl className="mt-stack-md divide-y divide-outline-variant">
        <div className="flex items-center justify-between py-stack-sm">
          <dt className="text-body-md text-on-surface-variant">Exchange rate</dt>
          <dd className="font-mono text-mono-data">1 XLM = ₱{formatPhp(quotedRate)}</dd>
        </div>
        <div className="flex items-center justify-between py-stack-sm">
          <dt className="text-body-md text-on-surface-variant">Network fee</dt>
          <dd className="font-mono text-mono-data">{displayXlm(networkFeeXlm)}</dd>
        </div>
        <div className="flex items-center justify-between py-stack-sm">
          <dt className="font-display text-body-md font-bold">Total deduction</dt>
          <dd>
            <MoneyAmount xlm={total} php={amountPhp} size="row" />
          </dd>
        </div>
      </dl>
    </Card>
  );
}
