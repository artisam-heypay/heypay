export function PhonePreview({
  businessName,
  city,
  bankLast4,
  amount,
}: {
  businessName: string;
  city?: string;
  bankLast4?: string;
  amount?: string;
}) {
  return (
    <div className="mx-auto w-[280px] rounded-xl border-8 border-on-surface/90 bg-background p-stack-md shadow-lg">
      <p className="mb-stack-md text-center text-label-md uppercase text-on-surface-variant">
        Payer preview
      </p>
      <div className="tonal-card rounded-lg p-stack-lg text-center">
        <span className="material-symbols-outlined icon-filled text-3xl text-primary">
          storefront
        </span>
        <p data-testid="preview-name" className="mt-stack-sm text-headline-md text-on-surface">
          {businessName || "Your business"}
        </p>
        <p className="text-body-sm text-on-surface-variant">{city || "City"}, PH</p>
        <div className="my-stack-md border-t border-outline-variant" />
        <p className="text-label-md uppercase text-on-surface-variant">Amount</p>
        <p className="text-display-lg text-primary">{amount ? `₱${amount}` : "₱0.00"}</p>
        <p className="mt-stack-sm font-mono text-mono-data text-on-surface-variant">
          Settles to •••• {bankLast4 || "0000"}
        </p>
        <button
          disabled
          className="mt-stack-md w-full rounded-full bg-primary py-3 text-body-md font-semibold text-on-primary opacity-90"
        >
          Pay with XLM
        </button>
      </div>
    </div>
  );
}
