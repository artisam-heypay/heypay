import { Card, MoneyAmount } from "@/components/ui";
import { type Decimal, displayPhp, displayXlm } from "@/lib/money";

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
      <p className="text-headline-lg font-display font-bold">{displayPhp(amountPhp)}</p>
      <dl className="mt-stack-md divide-y divide-outline-variant">
        <div className="flex items-center justify-between py-stack-sm">
          <dt className="text-on-surface-variant">Exchange rate</dt>
          <dd className="text-mono-data">1 XLM = {displayPhp(quotedRate)}</dd>
        </div>
        <div className="flex items-center justify-between py-stack-sm">
          <dt className="text-on-surface-variant">Network fee</dt>
          <dd className="text-mono-data">{displayXlm(networkFeeXlm)}</dd>
        </div>
        <div className="flex items-center justify-between py-stack-sm">
          <dt className="font-bold">Total deduction</dt>
          <dd>
            <MoneyAmount size="row" xlm={total} php={amountPhp} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}
