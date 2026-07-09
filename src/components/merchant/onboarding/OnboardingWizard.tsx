"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FloatingInput } from "@/components/ui/FloatingInput";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";
import { presignAndUpload } from "@/lib/client/upload";
import { decodeImageToRaw } from "@/lib/client/qr";
import type { MerchantDto } from "@/server/merchant/service";
import { ProgressBar } from "./ProgressBar";
import { PhonePreview } from "./PhonePreview";

const JSON_HEADERS = { "content-type": "application/json" };
async function callApi(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: JSON_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
  return data;
}

export function OnboardingWizard({ initial }: { initial: MerchantDto | null }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState(initial?.businessName ?? "");
  const [hasMerchant, setHasMerchant] = useState(Boolean(initial));
  const [bankCode, setBankCode] = useState(initial?.settlementBankCode ?? "");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [last4, setLast4] = useState(initial?.accountNumberLast4 ?? "");
  const [qrphRaw, setQrphRaw] = useState(initial?.qrphRaw ?? "");
  const [qrName, setQrName] = useState(initial?.qrphMerchantName ?? "");
  const [qrCity, setQrCity] = useState(initial?.qrphMerchantCity ?? "");
  const [rawInput, setRawInput] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const submitStep1 = () =>
    run(async () => {
      if (hasMerchant) await callApi("/api/merchant/me", "PATCH", { businessName });
      else {
        await callApi("/api/merchant", "POST", { businessName });
        setHasMerchant(true);
      }
      setStep(2);
    });

  const submitStep2 = () =>
    run(async () => {
      await callApi("/api/merchant/settlement", "POST", { bankCode, accountName, accountNumber });
      setLast4(accountNumber.slice(-4));
      setStep(3);
    });

  const onQrFile = (file: File) =>
    run(async () => {
      const raw = await decodeImageToRaw(file);
      let imageKey: string | undefined;
      try {
        imageKey = await presignAndUpload(file, "qrph");
      } catch {
        imageKey = undefined;
      }
      const data = await callApi("/api/merchant/qrph", "POST", { raw, imageKey });
      setQrphRaw(raw);
      setQrName(data.merchant.qrphMerchantName ?? "");
      setQrCity(data.merchant.qrphMerchantCity ?? "");
    });

  const submitStep3 = () =>
    run(async () => {
      let raw = qrphRaw;
      if (!raw && rawInput) {
        const data = await callApi("/api/merchant/qrph", "POST", { raw: rawInput });
        raw = rawInput;
        setQrphRaw(raw);
        setQrName(data.merchant.qrphMerchantName ?? "");
        setQrCity(data.merchant.qrphMerchantCity ?? "");
      }
      if (!raw) throw new Error("Please upload a QRPH image or paste your QRPH text");
      setStep(4);
    });

  const goLive = () =>
    run(async () => {
      await callApi("/api/merchant/go-live", "POST");
      router.push("/merchant/dashboard");
    });

  return (
    <div className="grid gap-margin-desktop lg:grid-cols-[1fr_320px]">
      <div className="tonal-card rounded-xl p-stack-lg lg:p-margin-desktop">
        <p className="mb-stack-sm text-label-md uppercase text-on-surface-variant">
          Step {step} of 4
        </p>
        <ProgressBar step={step} />

        {error && (
          <p
            role="alert"
            className="mt-stack-md rounded-lg bg-error/10 px-stack-md py-stack-sm text-body-sm text-error"
          >
            {error}
          </p>
        )}

        <div className="mt-stack-lg flex flex-col gap-stack-lg">
          {step === 1 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Business identity</h1>
              <FloatingInput
                id="businessName"
                label="Business name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                autoComplete="organization"
              />
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Settlement account</h1>
              <p className="text-body-sm text-on-surface-variant">
                PHP from each payment lands here.
              </p>
              <fieldset className="grid grid-cols-2 gap-stack-md">
                <legend className="mb-stack-sm text-label-md uppercase text-on-surface-variant">
                  Bank or wallet
                </legend>
                {SUPPORTED_BANKS.map((b) => (
                  <label
                    key={b.code}
                    className="relative flex min-h-11 cursor-pointer items-center gap-stack-md rounded-lg border-2 border-outline-variant p-stack-md has-[:checked]:border-primary has-[:checked]:bg-primary-container/30"
                  >
                    <input
                      type="radio"
                      name="bank"
                      value={b.code}
                      className="absolute inset-0 z-10 cursor-pointer opacity-0"
                      checked={bankCode === b.code}
                      onChange={() => setBankCode(b.code)}
                    />
                    <span className="material-symbols-outlined text-primary">account_balance</span>
                    <span className="text-body-sm font-medium">
                      {b.code} &middot; {b.name}
                    </span>
                  </label>
                ))}
              </fieldset>
              <FloatingInput
                id="accountName"
                label="Account name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                autoComplete="name"
              />
              <FloatingInput
                id="accountNumber"
                label="Account number"
                inputMode="numeric"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
              />
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Link your QRPH</h1>
              <p className="text-body-sm text-on-surface-variant">
                Upload a photo of your existing QRPH standee.
              </p>
              <label className="relative flex h-48 cursor-pointer flex-col items-center justify-center gap-stack-sm overflow-hidden rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low">
                <span className="material-symbols-outlined text-4xl text-primary">
                  qr_code_scanner
                </span>
                <span className="text-body-md">
                  {qrphRaw ? "QRPH linked — replace?" : "Upload QRPH image"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onQrFile(f);
                  }}
                />
                {busy && (
                  <span className="animate-scan pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />
                )}
              </label>
              <FloatingInput
                id="qrphRawPaste"
                label="Or paste raw QRPH text"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
              />
              {qrphRaw && (
                <p className="rounded-lg bg-primary/10 px-stack-md py-stack-sm text-body-sm text-primary">
                  Detected: {qrName || "merchant"} {qrCity ? `· ${qrCity}` : ""}
                </p>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Review &amp; go live</h1>
              <dl className="flex flex-col gap-stack-md">
                <Row label="Business" value={businessName} />
                <Row label="Settlement" value={`${bankCode} •••• ${last4}`} />
                <Row label="QRPH" value={qrName || "Linked"} />
              </dl>
            </>
          )}
        </div>

        <div className="mt-margin-desktop flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              disabled={busy}
              className="min-h-11 rounded-full border-2 border-outline-variant px-stack-lg py-stack-sm text-body-md text-on-surface"
            >
              Back
            </button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <button
              disabled={busy}
              onClick={step === 1 ? submitStep1 : step === 2 ? submitStep2 : submitStep3}
              className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-secondary px-stack-lg py-stack-sm text-body-md font-semibold text-on-secondary transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Continue"}
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={goLive}
              className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary shadow-lg shadow-primary/20 disabled:opacity-60"
            >
              {busy ? "Going live…" : "Go live"}
              <span className="material-symbols-outlined icon-filled">verified</span>
            </button>
          )}
        </div>
      </div>

      <div className="hidden lg:block">
        <PhonePreview businessName={businessName} city={qrCity} bankLast4={last4} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-stack-md py-stack-sm">
      <dt className="text-label-md uppercase text-on-surface-variant">{label}</dt>
      <dd className="font-mono text-mono-data text-on-surface">{value}</dd>
    </div>
  );
}
