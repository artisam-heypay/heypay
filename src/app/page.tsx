export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-stack-lg px-margin-mobile text-center">
      <span className="material-symbols-outlined icon-filled text-5xl text-primary">
        account_balance_wallet
      </span>
      <h1 className="font-display text-headline-lg text-primary">HeyPay</h1>
      <p className="font-body text-body-md text-on-surface-variant">
        Pay any QRPH merchant with your Stellar balance.
      </p>
      <p className="tonal-card rounded-xl px-stack-lg py-stack-md font-mono text-mono-data text-on-surface">
        Foundation ready.
      </p>
    </main>
  );
}
