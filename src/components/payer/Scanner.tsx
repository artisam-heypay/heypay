"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { Icon } from "@/components/ui";
import { ScanFrame } from "./ScanFrame";
import { MerchantNotRegistered } from "./MerchantNotRegistered";
import { AmountPrompt } from "./AmountPrompt";

type Decoded = { merchant: { id: string } | null; decoded: { amountPhp?: string | null } };

export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [notRegistered, setNotRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    stopCamera();
    setStatus(null);
    setMerchantId(null);
    setNotRegistered(false);
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function decodeImageData(img: ImageData): string | null {
    const result = jsQR(img.data, img.width, img.height);
    return result?.data ?? null;
  }

  async function resolveRaw(raw: string) {
    setBusy(true);
    setStatus("Resolving merchant…");
    try {
      const res = await fetch("/api/qrph/decode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) {
        setStatus("Could not read this code. Try again.");
        return;
      }
      const data = (await res.json()) as Decoded;
      if (!data.merchant) {
        setNotRegistered(true);
        return;
      }
      setMerchantId(data.merchant.id);
      if (data.decoded.amountPhp) {
        await quoteAndGo(data.merchant.id, data.decoded.amountPhp);
      } else {
        setStatus(null); // show AmountPrompt
      }
    } catch {
      setStatus("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function quoteAndGo(mId: string, amountPhp: string) {
    setBusy(true);
    setStatus("Locking exchange rate…");
    try {
      const res = await fetch("/api/payments/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantId: mId, amountPhp }),
      });
      if (!res.ok) {
        setStatus("Could not start payment. Try again.");
        return;
      }
      const { paymentId } = (await res.json()) as { paymentId: string };
      stopCamera();
      router.push(`/payer/pay/${paymentId}/confirm`);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const raw = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
      URL.revokeObjectURL(url);
      if (raw) void resolveRaw(raw);
      else setStatus("No QR code found in that image.");
    };
    img.src = url;
  }

  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus(
        "Camera needs a secure (HTTPS) connection. Open the secure URL or upload the QR image.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const tick = () => {
        if (!streamRef.current) return;
        const canvas = canvasRef.current;
        if (video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const raw = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
            if (raw) {
              void resolveRaw(raw);
              return;
            }
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setStatus("Camera unavailable. Upload an image of the QR instead.");
    }
  }

  if (notRegistered) return <MerchantNotRegistered onScanAgain={reset} />;

  if (merchantId && !busy && status === null) {
    return <AmountPrompt onSubmit={(amt) => quoteAndGo(merchantId, amt)} busy={busy} />;
  }

  return (
    <div className="flex flex-col gap-stack-md">
      <ScanFrame>
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
      </ScanFrame>
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex flex-wrap gap-stack-md">
        <button
          type="button"
          onClick={startCamera}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-3 font-display font-bold text-on-primary focus:outline-none focus:ring-4 focus:ring-primary/10"
        >
          <Icon name="photo_camera" />
          Use camera
        </button>
        <label className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-stack-sm rounded-full border-2 border-primary px-stack-lg py-3 font-display font-bold text-primary hover:bg-primary/5 focus-within:ring-4 focus-within:ring-primary/10">
          <Icon name="upload" />
          Upload image
          <input type="file" accept="image/*" onChange={onFile} className="sr-only" />
        </label>
      </div>

      {status && (
        <p aria-live="polite" className="text-body-md text-on-surface-variant">
          {status}
        </p>
      )}
    </div>
  );
}
