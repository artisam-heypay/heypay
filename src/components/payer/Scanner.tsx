"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { Button, Icon } from "@/components/ui";
import { readRefusal, type RefusedRequest } from "@/lib/payment-refusal";
import { ScanFrame } from "./ScanFrame";
import { MerchantNotRegistered } from "./MerchantNotRegistered";
import { AmountPrompt } from "./AmountPrompt";
import { PaymentRefusalNotice } from "./PaymentRefusalNotice";
import { FaucetCard } from "./FaucetCard";
import { PayWithChoice, type PayChoice } from "./PayWithChoice";

type Decoded = {
  merchant: { id: string; businessName?: string | null } | null;
  decoded: { amountPhp?: string | null };
};

/** A payment that could not be started, kept so it can be tried in another asset. */
type RefusedStart = {
  merchantId: string;
  amountPhp: string;
  asset: string;
  failure: RefusedRequest;
};

/** Whether a refused payment would go through with more XLM in the wallet. */
function shortOfXlm({ refusal }: RefusedRequest): boolean {
  return (
    refusal?.reason === "insufficient_fee" ||
    (refusal?.reason === "insufficient_balance" && refusal.asset === "XLM")
  );
}

export function Scanner({
  faucetXlm = null,
}: {
  /** The free test XLM the payer can still claim, or null when there is none to offer. */
  faucetXlm?: string | null;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);
  // While a code is being looked up the camera keeps running but frames are not read.
  const resolvingRef = useRef(false);
  // The last code that could not be used, so a camera held on it does not resend it every frame.
  const failedRawRef = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  // The code carried its own amount, so there is no amount to go back and change.
  const [amountFromCode, setAmountFromCode] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<RefusedStart | null>(null);
  // More than one asset can pay: the payer picks before a price is locked.
  const [choice, setChoice] = useState<{
    merchantId: string;
    amountPhp: string;
    options: PayChoice[];
  } | null>(null);
  // The asset picked from `choice`, while its price is being locked.
  const [pending, setPending] = useState<string | null>(null);

  // Leaving the scan page must turn the camera off, not leave it running unseen.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, []);

  function reset() {
    stopCamera();
    setStatus(null);
    setRefused(null);
    setChoice(null);
    setPending(null);
    setMerchantId(null);
    setMerchantName(null);
    setAmountFromCode(false);
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
    resolvingRef.current = true;
    setBusy(true);
    setStatus("Resolving merchant…");
    try {
      const res = await fetch("/api/qrph/decode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) {
        // A running camera goes on scanning for a code it can use.
        failedRawRef.current = raw;
        setStatus("Could not read this code. Try again.");
        return;
      }
      const data = (await res.json()) as Decoded;
      // The code is read: what comes next is not the scan view, so the camera is done.
      stopCamera();
      if (!data.merchant) {
        setNotRegistered(true);
        return;
      }
      setMerchantId(data.merchant.id);
      setMerchantName(data.merchant.businessName ?? null);
      setAmountFromCode(Boolean(data.decoded.amountPhp));
      if (data.decoded.amountPhp) {
        await quoteAndGo(data.merchant.id, data.decoded.amountPhp);
      } else {
        setStatus(null); // show AmountPrompt
      }
    } catch {
      failedRawRef.current = raw;
      setStatus("Network error. Try again.");
    } finally {
      resolvingRef.current = false;
      setBusy(false);
    }
  }

  /**
   * Quotes the payment in `asset`. With none given, the server starts it in the
   * one asset the wallet can pay with, or answers with the ones that can.
   */
  async function quoteAndGo(mId: string, amountPhp: string, asset?: string) {
    setBusy(true);
    setRefused(null);
    setStatus("Locking exchange rate…");
    try {
      const res = await fetch("/api/payments/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantId: mId,
          amountPhp,
          ...(asset ? { asset } : { chooseAsset: true }),
        }),
      });
      if (!res.ok) {
        // Say why, with the way out next to it, as the confirm screen does.
        const failure = readRefusal(
          await res.json().catch(() => null),
          "Could not start payment. Try again.",
        );
        setRefused({ merchantId: mId, amountPhp, asset: asset ?? "XLM", failure });
        setChoice(null);
        setPending(null);
        setStatus(null);
        return;
      }
      const { paymentId, choose } = (await res.json()) as {
        paymentId?: string;
        choose?: PayChoice[];
      };
      stopCamera();
      if (choose) {
        setChoice({ merchantId: mId, amountPhp, options: choose });
        setStatus(null);
        return;
      }
      router.push(`/payer/pay/${paymentId}/confirm`);
    } catch {
      setChoice(null);
      setPending(null);
      setStatus("Network error. Try again.");
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
    stopCamera();
    failedRawRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      // The payer may have left while the permission prompt was open.
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      // A second tap while the first prompt was open must not leave two cameras on.
      stopCamera();
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      const tick = () => {
        // Stopped, or replaced by a newer stream with its own loop.
        if (streamRef.current !== stream) return;
        const canvas = canvasRef.current;
        if (!resolvingRef.current && video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const raw = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
            if (raw && raw !== failedRawRef.current) void resolveRaw(raw);
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      stopCamera();
      setStatus("Camera unavailable. Upload an image of the QR instead.");
    }
  }

  if (notRegistered) return <MerchantNotRegistered onScanAgain={reset} />;

  if (choice) {
    return (
      <PayWithChoice
        amountPhp={choice.amountPhp}
        merchantName={merchantName}
        options={choice.options}
        pending={pending}
        backLabel={amountFromCode ? "Scan again" : "Change amount"}
        onPick={(asset) => {
          setPending(asset);
          void quoteAndGo(choice.merchantId, choice.amountPhp, asset);
        }}
        // Back to the amount, which shows again once no choice is open.
        onBack={amountFromCode ? reset : () => setChoice(null)}
      />
    );
  }

  if (merchantId && !busy && status === null && !refused) {
    return <AmountPrompt onSubmit={(amt) => quoteAndGo(merchantId, amt)} busy={busy} />;
  }

  return (
    <div className="flex flex-col gap-stack-md">
      <ScanFrame>
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
        />
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
      {refused && (
        <PaymentRefusalNotice
          refused={refused.failure}
          currentAsset={refused.asset}
          busy={busy}
          onPayWith={(asset) => void quoteAndGo(refused.merchantId, refused.amountPhp, asset)}
        />
      )}
      {refused && faucetXlm && shortOfXlm(refused.failure) && (
        // Claim, then try the same payment again without scanning the code again.
        <>
          <FaucetCard amountXlm={faucetXlm} />
          <Button
            type="button"
            size="md"
            variant="outline-pill"
            className="self-start"
            disabled={busy}
            onClick={() => void quoteAndGo(refused.merchantId, refused.amountPhp, refused.asset)}
          >
            Try again
          </Button>
        </>
      )}
    </div>
  );
}
