"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import { FloatingInput } from "@/components/ui/FloatingInput";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";
import { createMerchantSchema, settlementSchema } from "@/lib/schemas/merchant";
import { presignAndUpload } from "@/lib/client/upload";
import { decodeImageToRaw } from "@/lib/client/qr";
import type { MerchantDto } from "@/server/merchant/service";
import { ProgressBar } from "./ProgressBar";
import { PhonePreview } from "./PhonePreview";

type Field =
  | "businessName"
  | "bankCode"
  | "accountName"
  | "accountNumber"
  | "payoutEmail"
  | "qrph"
  | "qrphText";
type FieldErrors = Partial<Record<Field, string>>;

/** A request refused, with what is wrong with each field when the server said. */
class FormError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fields: FieldErrors = {},
  ) {
    super(message);
  }
}

/** The first message per field of a zod `flatten()`, as the API sends it in `details`. */
function firstErrors(details: unknown): FieldErrors {
  const fieldErrors = (details as { fieldErrors?: Record<string, string[] | undefined> } | null)
    ?.fieldErrors;
  if (!fieldErrors) return {};
  return Object.fromEntries(
    Object.entries(fieldErrors).flatMap(([field, msgs]) => (msgs?.[0] ? [[field, msgs[0]]] : [])),
  );
}

/** Checks the step's fields in the browser, with the rules the API applies. */
function validate(schema: z.ZodTypeAny, value: unknown): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new FormError("", 400, firstErrors(result.error.flatten()));
  }
}

const QRPH_UNREADABLE = {
  qrph: "This isn't a QRPH code we can use. Upload a clear photo of your QRPH standee.",
  qrphText: "This isn't a QRPH code we can use. Check that you pasted the whole code.",
};
const QRPH_NO_CODE_IN_PHOTO =
  "We couldn't find a QR code in that photo. Try a closer, sharper photo of the whole code.";

const JSON_HEADERS = { "content-type": "application/json" };
async function callApi(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: JSON_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new FormError(
      data?.error?.message ?? "Request failed",
      res.status,
      firstErrors(data?.error?.details),
    );
  }
  return data;
}

/** Links a QRPH, saying in plain words, next to `field`, why a code was refused. */
async function linkQrph(field: "qrph" | "qrphText", body: { raw: string; imageKey?: string }) {
  try {
    return await callApi("/api/merchant/qrph", "POST", body);
  } catch (e) {
    // A code another merchant owns is explained by the server; anything else
    // it refuses is a code that is not a usable QRPH.
    if (e instanceof FormError && e.status === 400) {
      throw new FormError("", 400, { [field]: QRPH_UNREADABLE[field] });
    }
    if (e instanceof FormError && e.status === 409) {
      throw new FormError("", 409, { [field]: e.message });
    }
    throw e;
  }
}

export function OnboardingWizard({ initial }: { initial: MerchantDto | null }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [businessName, setBusinessName] = useState(initial?.businessName ?? "");
  const [hasMerchant, setHasMerchant] = useState(Boolean(initial));
  const [bankCode, setBankCode] = useState(initial?.settlementBankCode ?? "");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [payoutEmail, setPayoutEmail] = useState(initial?.payoutEmail ?? "");
  const [last4, setLast4] = useState(initial?.accountNumberLast4 ?? "");
  const [qrphRaw, setQrphRaw] = useState(initial?.qrphRaw ?? "");
  const [qrName, setQrName] = useState(initial?.qrphMerchantName ?? "");
  const [qrCity, setQrCity] = useState(initial?.qrphMerchantCity ?? "");
  const [rawInput, setRawInput] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof FormError && Object.keys(e.fields).length > 0) setFieldErrors(e.fields);
      else setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // The sidebar's business name and the setup banner come from the layout,
  // which does not render again by itself: refresh it after each saved step.
  const saved = () => router.refresh();

  const submitStep1 = () =>
    run(async () => {
      validate(createMerchantSchema, { businessName });
      if (hasMerchant) await callApi("/api/merchant/me", "PATCH", { businessName });
      else {
        await callApi("/api/merchant", "POST", { businessName });
        setHasMerchant(true);
      }
      saved();
      setStep(2);
    });

  const submitStep2 = () =>
    run(async () => {
      const settlement = { bankCode, accountName, accountNumber, payoutEmail };
      validate(settlementSchema, settlement);
      await callApi("/api/merchant/settlement", "POST", settlement);
      saved();
      setLast4(accountNumber.slice(-4));
      setStep(3);
    });

  const onQrFile = (file: File) =>
    run(async () => {
      let raw: string;
      try {
        raw = await decodeImageToRaw(file);
      } catch {
        throw new FormError("", 400, { qrph: QRPH_NO_CODE_IN_PHOTO });
      }
      let imageKey: string | undefined;
      try {
        imageKey = await presignAndUpload(file, "qrph");
      } catch {
        imageKey = undefined;
      }
      const data = await linkQrph("qrph", { raw, imageKey });
      saved();
      setQrphRaw(raw);
      setQrName(data.merchant.qrphMerchantName ?? "");
      setQrCity(data.merchant.qrphMerchantCity ?? "");
    });

  const submitStep3 = () =>
    run(async () => {
      let raw = qrphRaw;
      if (!raw && rawInput) {
        const data = await linkQrph("qrphText", { raw: rawInput });
        saved();
        raw = rawInput;
        setQrphRaw(raw);
        setQrName(data.merchant.qrphMerchantName ?? "");
        setQrCity(data.merchant.qrphMerchantCity ?? "");
      }
      if (!raw) {
        throw new FormError("", 400, {
          qrph: "Upload a photo of your QRPH standee, or paste its text.",
        });
      }
      setStep(4);
    });

  const goLive = () =>
    run(async () => {
      await callApi("/api/merchant/go-live", "POST");
      // The dashboard's layout was rendered before the merchant went live.
      router.push("/merchant/dashboard");
      router.refresh();
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
              <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">
                Business identity
              </h1>
              <FloatingInput
                id="businessName"
                label="Business name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                autoComplete="organization"
                error={fieldErrors.businessName}
              />
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">
                Settlement account
              </h1>
              <p className="text-body-sm text-on-surface-variant">
                PHP from each payment lands here.
              </p>
              <div className="rounded-lg border border-primary/30 bg-primary-container/20 p-stack-md">
                <p className="mb-stack-sm text-label-md uppercase text-primary">
                  Test settlement account
                </p>
                <p className="text-body-sm text-on-surface-variant">
                  In Xendit test mode no real money moves, so any account works, e.g.:
                </p>
                <dl className="mt-stack-sm flex flex-col gap-stack-sm font-mono text-mono-data">
                  <div className="flex items-center justify-between gap-stack-md">
                    <dt className="text-on-surface-variant">Wallet</dt>
                    <dd className="text-on-surface">GCash</dd>
                  </div>
                  <div className="flex items-center justify-between gap-stack-md">
                    <dt className="text-on-surface-variant">Number</dt>
                    <dd className="text-on-surface">09171234567</dd>
                  </div>
                </dl>
              </div>
              <fieldset aria-describedby={fieldErrors.bankCode ? "bankCode-error" : undefined}>
                <legend className="mb-stack-sm text-label-md uppercase text-on-surface-variant">
                  Bank or e-wallet
                </legend>
                <div className="grid grid-cols-2 gap-stack-md">
                  {SUPPORTED_BANKS.map((b) => (
                    <label
                      key={b.code}
                      className="relative flex min-h-11 min-w-0 cursor-pointer flex-col items-start gap-1 rounded-lg border-2 border-outline-variant p-stack-md sm:flex-row sm:items-center sm:gap-stack-sm has-[:checked]:border-primary has-[:checked]:bg-primary-container/30 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
                    >
                      <input
                        type="radio"
                        name="bank"
                        value={b.code}
                        className="absolute inset-0 z-10 cursor-pointer opacity-0"
                        checked={bankCode === b.code}
                        onChange={() => setBankCode(b.code)}
                      />
                      <span className="material-symbols-outlined shrink-0 text-primary" aria-hidden>
                        {b.kind === "wallet" ? "account_balance_wallet" : "account_balance"}
                      </span>
                      {/* The icon sits above the name on a phone, so a long name wraps
                          between words inside the tile instead of running past its edge. */}
                      <span className="flex min-w-0 flex-col break-words">
                        <span className="text-body-md font-semibold">{b.short}</span>
                        {b.name !== b.short && (
                          <span className="text-body-sm text-on-surface-variant">{b.name}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {fieldErrors.bankCode && (
                  <p id="bankCode-error" className="mt-stack-sm text-body-sm text-error">
                    {fieldErrors.bankCode}
                  </p>
                )}
              </fieldset>
              <FloatingInput
                id="accountName"
                label="Account name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                autoComplete="name"
                error={fieldErrors.accountName}
              />
              <FloatingInput
                id="accountNumber"
                label="Account number"
                inputMode="numeric"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                error={fieldErrors.accountNumber}
              />
              <FloatingInput
                id="payoutEmail"
                label="Payout receipt email"
                type="email"
                value={payoutEmail}
                onChange={(e) => setPayoutEmail(e.target.value)}
                autoComplete="email"
                error={fieldErrors.payoutEmail}
              />
              <p className="text-body-sm text-on-surface-variant">
                Xendit emails a receipt here each time a payment is paid out to you.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">
                Link your QRPH
              </h1>
              <p className="text-body-sm text-on-surface-variant">
                Upload a photo of your existing QRPH standee.
              </p>
              <label
                className={`relative flex h-48 cursor-pointer flex-col items-center justify-center gap-stack-sm overflow-hidden rounded-xl border-2 border-dashed bg-surface-container-low ${
                  fieldErrors.qrph ? "border-error" : "border-outline-variant"
                }`}
              >
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
                  aria-describedby={fieldErrors.qrph ? "qrph-error" : undefined}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onQrFile(f);
                  }}
                />
                {busy && (
                  <span className="animate-scan pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />
                )}
              </label>
              {fieldErrors.qrph && (
                <p id="qrph-error" className="-mt-stack-sm text-body-sm text-error">
                  {fieldErrors.qrph}
                </p>
              )}
              <FloatingInput
                id="qrphRawPaste"
                label="Or paste raw QRPH text"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                error={fieldErrors.qrphText}
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
              <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">
                Review &amp; go live
              </h1>
              <dl className="flex flex-col gap-stack-md">
                <Row label="Business" value={businessName} />
                <Row label="Settlement" value={`${bankCode} •••• ${last4}`} />
                <Row label="Receipts to" value={payoutEmail} />
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
  // A long value moves under its label instead of running into it.
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-stack-md gap-y-1 rounded-lg bg-surface-container-low px-stack-md py-stack-sm">
      <dt className="shrink-0 text-label-md uppercase text-on-surface-variant">{label}</dt>
      <dd className="min-w-0 font-mono text-mono-data text-on-surface [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}
