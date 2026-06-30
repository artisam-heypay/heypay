"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { Button, Card, Icon } from "@/components/ui";
import { ScanFrame } from "./ScanFrame";
import { MerchantNotRegistered } from "./MerchantNotRegistered";
import { AmountPrompt } from "./AmountPrompt";

type DecodeResponse = {
  decoded: { amountPhp?: string | null };
  merchant: { id: string; businessName: string } | null;
};

export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const [mode, setMode] = useState<"camera" | "upload">("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);
  const [pendingMerchant, setPendingMerchant] = useState<{
    id: string;
    businessName: string;
  } | null>(null);

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => stopCamera, []);

  async function createQuote(merchantId: string, amountPhp: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/payments/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantId, amountPhp }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(e?.error?.message ?? "Could not start the payment.");
      }
      const { paymentId } = (await res.json()) as { paymentId: string };
      router.push(`/payer/pay/${paymentId}/confirm`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function handleRaw(raw: string) {
    stopCamera();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/qrph/decode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(e?.error?.message ?? "Could not read this QR code.");
      }
      const body = (await res.json()) as DecodeResponse;
      if (!body.merchant) {
        setNotRegistered(true);
        return;
      }
      if (body.decoded.amountPhp) {
        await createQuote(body.merchant.id, String(body.decoded.amountPhp));
      } else {
        setPendingMerchant(body.merchant);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onUpload(file: File) {
    setError(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) {
        setError("Could not read the image.");
        return;
      }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(data.data, data.width, data.height);
      if (!result) {
        setError("No QR code found in that image.");
        return;
      }
      void handleRaw(result.data);
    };
    img.onerror = () => setError("Could not read the image.");
    img.src = url;
  }

  async function startCamera() {
    setMode("camera");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement("canvas");
      const tick = () => {
        if (!streamRef.current) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(data.data, data.width, data.height);
            if (result) {
              void handleRaw(result.data);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setError("Camera unavailable. Upload a QR image instead.");
      setMode("upload");
    }
  }

  if (notRegistered) {
    return (
      <MerchantNotRegistered
        onScanAgain={() => {
          setNotRegistered(false);
          setError(null);
        }}
      />
    );
  }
  if (pendingMerchant) {
    return (
      <AmountPrompt
        merchantName={pendingMerchant.businessName}
        pending={busy}
        onSubmit={(amt) => void createQuote(pendingMerchant.id, amt)}
      />
    );
  }

  return (
    <Card>
      <div className="mb-stack-md flex gap-stack-sm">
        <Button
          variant={mode === "upload" ? "primary-pill" : "outline-pill"}
          size="md"
          onClick={() => {
            stopCamera();
            setMode("upload");
          }}
        >
          Upload image
        </Button>
        <Button
          variant={mode === "camera" ? "primary-pill" : "outline-pill"}
          size="md"
          onClick={() => void startCamera()}
        >
          Use camera
        </Button>
      </div>
      <ScanFrame scanning={!busy}>
        {mode === "camera" ? (
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-on-surface-variant">
            <Icon name="image" className="text-5xl" />
          </div>
        )}
      </ScanFrame>
      {mode === "upload" && (
        <label className="mt-stack-md flex min-h-11 cursor-pointer items-center justify-center gap-stack-sm rounded-full border-2 border-primary px-stack-lg py-3 text-primary focus-within:ring-4 focus-within:ring-primary/10">
          <Icon name="upload" /> Choose a QR image
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
        </label>
      )}
      <p aria-live="polite" className="mt-stack-md text-body-sm text-on-surface-variant">
        {busy
          ? "Reading QR code…"
          : (error ?? "Point your camera at a QRPH code or upload a photo.")}
      </p>
      {error ? (
        <span role="alert" className="sr-only">
          {error}
        </span>
      ) : null}
    </Card>
  );
}
