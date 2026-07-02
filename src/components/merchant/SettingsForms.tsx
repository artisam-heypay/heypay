"use client";
import { useRef, useState } from "react";
import { FloatingInput } from "@/components/ui/FloatingInput";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";
import { presignAndUpload } from "@/lib/client/upload";
import { decodeImageToRaw } from "@/lib/client/qr";
import type { MerchantDto } from "@/server/merchant/service";

const JSON_HEADERS = { "content-type": "application/json" };
async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: JSON_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
  return data;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tonal-card flex flex-col gap-stack-md rounded-xl p-stack-lg">
      <h2 className="text-headline-md">{title}</h2>
      {children}
    </section>
  );
}

function Note({ msg }: { msg: { kind: "ok" | "err"; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      role="status"
      className={`rounded-lg px-stack-md py-stack-sm text-body-sm ${
        msg.kind === "ok" ? "bg-primary/10 text-primary" : "bg-error/10 text-error"
      }`}
    >
      {msg.text}
    </p>
  );
}

export function SettingsForms({ merchant }: { merchant: MerchantDto }) {
  const qrInputRef = useRef<HTMLInputElement>(null);
  const [businessName, setBusinessName] = useState(merchant.businessName);
  const [bankCode, setBankCode] = useState(merchant.settlementBankCode);
  const [accountName, setAccountName] = useState(merchant.accountName);
  const [accountNumber, setAccountNumber] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [qrName, setQrName] = useState(merchant.qrphMerchantName ?? "");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<Record<string, { kind: "ok" | "err"; text: string } | null>>({});

  const set = (key: string, kind: "ok" | "err", text: string) =>
    setNote((n) => ({ ...n, [key]: { kind, text } }));
  const guard = (key: string, fn: () => Promise<void>) => async () => {
    setNote((n) => ({ ...n, [key]: null }));
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
      set(key, "ok", "Saved");
    } catch (e) {
      set(key, "err", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const saveBusiness = guard("biz", async () => {
    await call("/api/merchant/me", "PATCH", { businessName });
  });
  const onLogo = (f: File) =>
    guard("logo", async () => {
      const key = await presignAndUpload(f, "logo");
      await call("/api/merchant/me", "PATCH", { logoKey: key });
    })();
  const saveBank = guard("bank", async () => {
    await call("/api/merchant/settlement", "POST", { bankCode, accountName, accountNumber });
  });
  const onQr = (f: File) => {
    const run = guard("qr", async () => {
      const raw = await decodeImageToRaw(f);
      let imageKey: string | undefined;
      try {
        imageKey = await presignAndUpload(f, "qrph");
      } catch {
        imageKey = undefined;
      }
      const data = await call("/api/merchant/qrph", "POST", { raw, imageKey });
      setQrName(data.merchant.qrphMerchantName ?? "");
    });
    run().finally(() => {
      if (qrInputRef.current) qrInputRef.current.value = "";
    });
  };
  const savePw = guard("pw", async () => {
    await call("/api/auth/password", "POST", pw);
    setPw({ currentPassword: "", newPassword: "" });
  });

  return (
    <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-2">
      <Section title="Business identity">
        <FloatingInput
          id="businessName"
          label="Business name"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-stack-md rounded-lg border border-outline-variant px-stack-md py-stack-sm text-body-md text-on-surface-variant">
          <span className="material-symbols-outlined text-primary">image</span>
          {merchant.logoKey ? "Replace logo" : "Upload logo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLogo(f);
            }}
          />
        </label>
        <Note msg={note.biz ?? note.logo ?? null} />
        <button
          onClick={saveBusiness}
          className="min-h-11 self-start rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary"
        >
          Save business
        </button>
      </Section>

      <Section title="Settlement account">
        <p className="font-mono text-mono-data text-on-surface-variant">
          Current: {merchant.settlementBankName} •••• {merchant.accountNumberLast4}
        </p>
        <select
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md"
        >
          {SUPPORTED_BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code} &middot; {b.name}
            </option>
          ))}
        </select>
        <FloatingInput
          id="settAccountName"
          label="Account name"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
        />
        <FloatingInput
          id="settAccountNumber"
          label="New account number"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
        />
        <Note msg={note.bank ?? null} />
        <button
          onClick={saveBank}
          className="min-h-11 self-start rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary"
        >
          Save bank
        </button>
      </Section>

      <Section title="QRPH">
        <p className="text-body-sm text-on-surface-variant">Linked: {qrName || "—"}</p>
        <label
          className={`flex min-h-11 cursor-pointer items-center gap-stack-md rounded-lg border border-outline-variant px-stack-md py-stack-sm text-body-md text-on-surface-variant ${
            busy.qr ? "cursor-wait opacity-60" : ""
          }`}
        >
          <span className="material-symbols-outlined text-primary">qr_code_scanner</span>
          {busy.qr ? "Scanning QRPH…" : "Re-link QRPH"}
          <input
            ref={qrInputRef}
            type="file"
            accept="image/*"
            disabled={busy.qr}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onQr(f);
            }}
          />
        </label>
        <Note msg={note.qr ?? null} />
      </Section>

      <Section title="Change password">
        <FloatingInput
          id="currentPassword"
          label="Current password"
          type="password"
          value={pw.currentPassword}
          onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
          autoComplete="current-password"
        />
        <FloatingInput
          id="newPassword"
          label="New password"
          type="password"
          value={pw.newPassword}
          onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
          autoComplete="new-password"
        />
        <Note msg={note.pw ?? null} />
        <button
          onClick={savePw}
          className="min-h-11 self-start rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary"
        >
          Update password
        </button>
      </Section>
    </div>
  );
}
