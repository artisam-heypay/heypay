import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { push, jsQR } = vi.hoisted(() => ({ push: vi.fn(), jsQR: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// Reading a real code is jsQR's job: each test says what the image or frame "contains".
vi.mock("jsqr", () => ({ default: jsQR }));

import { Scanner } from "./Scanner";

type Reply = { status: number; body: unknown };
const refused = (status: number, message: string, details?: Record<string, string>): Reply => ({
  status,
  body: { error: { code: "REFUSED", message, details } },
});
const DECODED: Reply = {
  status: 200,
  body: { merchant: { id: "m1" }, decoded: { amountPhp: "100.00" } },
};

/** Answers each request from the first reply queued for its path. */
function mockApi(replies: Record<string, Reply[]>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const reply = replies[String(input)]?.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
}

/** The body of each quote request, in order. */
function quotes(fetchMock: ReturnType<typeof mockApi>): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/payments/quote")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

async function uploadQr() {
  const file = new File(["png"], "qr.png", { type: "image/png" });
  await userEvent.upload(screen.getByLabelText(/Upload image/), file);
}

beforeEach(() => {
  vi.clearAllMocks();
  jsQR.mockReturnValue({ data: "QRPH-RAW" });
  // jsdom neither loads images nor draws on a canvas: stand in for both.
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      width = 1;
      height = 1;
      set src(_url: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:qr", revokeObjectURL: () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Scanner", () => {
  it("goes to the confirm screen when the payment can be started", async () => {
    const fetchMock = mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [{ status: 200, body: { paymentId: "p1" } }],
    });
    render(<Scanner />);
    await uploadQr();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/payer/pay/p1/confirm"));
    // No asset is named: the server starts it in the one the wallet can pay with.
    expect(quotes(fetchMock)).toEqual([
      { merchantId: "m1", amountPhp: "100.00", chooseAsset: true },
    ]);
  });

  it("asks which coin to pay with when the wallet can pay in either", async () => {
    const fetchMock = mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [
        {
          status: 200,
          body: {
            choose: [
              { asset: "XLM", amountAsset: "8.3333334", available: "100.0000000" },
              { asset: "USDC", amountAsset: "1.6041066", available: "50.0000000" },
            ],
          },
        },
        { status: 200, body: { paymentId: "p4" } },
      ],
    });
    render(<Scanner />);
    await uploadQr();

    const usdc = await screen.findByRole("button", { name: "USDC, about 1.6041066 USDC" });
    expect(screen.getByRole("heading", { name: "Pay ₱100.00" })).toBeInTheDocument();
    expect(screen.getByText("Uses 3% of your USDC")).toBeInTheDocument();
    // The code carried the amount, so the way back is to scan again.
    expect(screen.getByRole("button", { name: "Scan again" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); // no price is locked until the payer picks
    await userEvent.click(usdc);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/payer/pay/p4/confirm"));
    expect(quotes(fetchMock)[1]).toEqual({ merchantId: "m1", amountPhp: "100.00", asset: "USDC" });
  });

  it("says why a payment could not be started, and what to do about it", async () => {
    mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [
        refused(409, "Not enough XLM — add more.", {
          reason: "insufficient_balance",
          asset: "XLM",
        }),
      ],
    });
    render(<Scanner />);
    await uploadQr();

    expect(await screen.findByRole("alert")).toHaveTextContent("Not enough XLM — add more.");
    expect(screen.getByRole("link", { name: "Add XLM" })).toHaveAttribute("href", "/payer/prefund");
    expect(screen.queryByText(/Could not start payment/)).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("offers the free test XLM to a payer short of XLM, then tries the same payment again", async () => {
    const fetchMock = mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [
        refused(409, "Not enough XLM — add more.", {
          reason: "insufficient_balance",
          asset: "XLM",
        }),
        { status: 200, body: { paymentId: "p3" } },
      ],
      "/api/wallet/faucet": [{ status: 200, body: { txUrl: "" } }],
    });
    render(<Scanner faucetXlm="20.0000000" />);
    await uploadQr();

    await userEvent.click(await screen.findByRole("button", { name: "Claim 20 XLM" }));
    expect(await screen.findByText(/20 XLM is on its way/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/payer/pay/p3/confirm"));
    expect(quotes(fetchMock)[1]).toEqual({ merchantId: "m1", amountPhp: "100.00", asset: "XLM" });
  });

  it("offers no free test XLM when the payer has claimed it", async () => {
    mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [
        refused(409, "Not enough XLM — add more.", {
          reason: "insufficient_balance",
          asset: "XLM",
        }),
      ],
    });
    render(<Scanner />);
    await uploadQr();

    expect(await screen.findByRole("alert")).toHaveTextContent("Not enough XLM — add more.");
    expect(screen.queryByRole("button", { name: /Claim/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("offers the asset the wallet does hold, and starts the payment in it", async () => {
    const fetchMock = mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [
        refused(409, "Not enough XLM — add more or pay with USDC.", {
          reason: "insufficient_balance",
          asset: "XLM",
          payWith: "USDC",
        }),
        { status: 200, body: { paymentId: "p2" } },
      ],
    });
    render(<Scanner />);
    await uploadQr();

    await userEvent.click(await screen.findByRole("button", { name: "Pay with USDC" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/payer/pay/p2/confirm"));
    expect(quotes(fetchMock)[1]).toEqual({ merchantId: "m1", amountPhp: "100.00", asset: "USDC" });
  });

  it("gives the reason when the other asset cannot pay either", async () => {
    mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [
        refused(409, "Not enough XLM — add more or pay with USDC.", {
          reason: "insufficient_balance",
          asset: "XLM",
          payWith: "USDC",
        }),
        refused(409, "Not enough XLM for the network fee — add about 0.21 XLM.", {
          reason: "insufficient_fee",
          asset: "USDC",
          feeXlm: "0.21",
        }),
      ],
    });
    render(<Scanner />);
    await uploadQr();
    await userEvent.click(await screen.findByRole("button", { name: "Pay with USDC" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Not enough XLM for the network fee — add about 0.21 XLM.",
      ),
    );
    expect(screen.getByRole("link", { name: "Add XLM" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay with USDC" })).not.toBeInTheDocument();
  });

  it("shows the server's message for a failure that is not about the wallet", async () => {
    mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [refused(404, "merchant not available for payment")],
    });
    render(<Scanner />);
    await uploadQr();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "merchant not available for payment",
    );
  });

  it("falls back to a plain message when the server gives none", async () => {
    mockApi({
      "/api/qrph/decode": [DECODED],
      "/api/payments/quote": [{ status: 502, body: null }],
    });
    render(<Scanner />);
    await uploadQr();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not start payment. Try again.",
    );
  });
});

describe("Scanner camera", () => {
  let stopTrack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stopTrack = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) },
    });
    // jsdom plays no video: stand in for a camera feed that always has a frame ready.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0),
    );
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  /** The raw code sent in each decode request, in order. */
  function decodes(fetchMock: ReturnType<typeof mockApi>): unknown[] {
    return fetchMock.mock.calls
      .filter(([url]) => url === "/api/qrph/decode")
      .map(([, init]) => (JSON.parse(String(init?.body)) as { raw: unknown }).raw);
  }

  it("turns the camera off when the payer leaves the scan page", async () => {
    jsQR.mockReturnValue(null);
    const { unmount } = render(<Scanner />);
    await userEvent.click(screen.getByRole("button", { name: "Use camera" }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(stopTrack).not.toHaveBeenCalled();

    unmount();

    expect(stopTrack).toHaveBeenCalled();
  });

  it("keeps scanning after a code it cannot read, without resending that code", async () => {
    // The camera sees an unreadable code for several frames, then a merchant's.
    for (let i = 0; i < 5; i++) jsQR.mockReturnValueOnce({ data: "NOT-QRPH" });
    const fetchMock = mockApi({
      "/api/qrph/decode": [refused(400, "not a QR Ph code"), DECODED],
      "/api/payments/quote": [{ status: 200, body: { paymentId: "p1" } }],
    });
    render(<Scanner />);
    await userEvent.click(screen.getByRole("button", { name: "Use camera" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/payer/pay/p1/confirm"));
    expect(decodes(fetchMock)).toEqual(["NOT-QRPH", "QRPH-RAW"]);
    // Once the code is read the camera is no longer needed.
    expect(stopTrack).toHaveBeenCalled();
  });
});
