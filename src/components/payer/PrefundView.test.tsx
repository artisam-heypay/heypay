import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrefundView } from "./PrefundView";

const ISSUER = "GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER";

const XLM = {
  asset: "XLM",
  balance: "10.0000000",
  approxPhp: "35.00",
  trustlineRequired: false,
  canReceive: true,
  issuer: null,
};
const USDC = {
  asset: "USDC",
  balance: "0.0000000",
  approxPhp: "0.00",
  trustlineRequired: true,
  canReceive: true,
  issuer: ISSUER,
};
const USDT = {
  asset: "USDT",
  balance: "0.0000000",
  approxPhp: "0.00",
  trustlineRequired: true,
  canReceive: false,
  issuer: ISSUER,
};

const view = (assets = [XLM, USDC, USDT]) =>
  render(<PrefundView publicKey="GABC123" qrSvg="<svg></svg>" assets={assets} />);

afterEach(() => vi.restoreAllMocks());

describe("PrefundView", () => {
  it("offers every enabled asset and starts on the first", () => {
    view();
    for (const code of ["XLM", "USDC", "USDT"]) {
      expect(screen.getByRole("radio", { name: new RegExp(code) })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: /XLM/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("XLM Balance")).toBeInTheDocument();
  });

  it("switching asset swaps the balance and the deposit instructions", async () => {
    const user = userEvent.setup();
    view();
    expect(screen.getByText(/Send only XLM on the Stellar network/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /USDC/ }));

    expect(screen.getByText("USDC Balance")).toBeInTheDocument();
    expect(screen.getByText(/Send only USDC on the Stellar network/)).toBeInTheDocument();
    // The address is the same account for every Stellar asset.
    expect(screen.getByText("GABC123")).toBeInTheDocument();
  });

  it("names the accepted issuer for an issued asset — a same-code token from another issuer is rejected", async () => {
    const user = userEvent.setup();
    view();
    // XLM is native and has no issuer to show.
    expect(screen.queryByText(ISSUER)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /USDC/ }));

    expect(screen.getByText(ISSUER)).toBeInTheDocument();
    expect(screen.getByText(/Accepted USDC issuer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy asset issuer" })).toBeInTheDocument();
  });

  it("withholds the deposit address for an untrusted asset", async () => {
    // Depositing USDT before the trustline exists gets rejected by the network,
    // so the address must not be shown yet.
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("radio", { name: /USDT/ }));

    expect(screen.queryByText("GABC123")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enable USDT/ })).toBeInTheDocument();
  });

  it("reveals the address once the trustline is established", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ asset: "USDT", canReceive: true }), { status: 200 }),
    );
    view();
    await user.click(screen.getByRole("radio", { name: /USDT/ }));
    await user.click(screen.getByRole("button", { name: /Enable USDT/ }));

    expect(await screen.findByText("GABC123")).toBeInTheDocument();
    expect(screen.getByText(/Send only USDT on the Stellar network/)).toBeInTheDocument();
  });

  it("surfaces why the trustline was refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Fund your wallet with at least 1.0 XLM first." } }),
        {
          status: 409,
        },
      ),
    );
    view();
    await user.click(screen.getByRole("radio", { name: /USDT/ }));
    await user.click(screen.getByRole("button", { name: /Enable USDT/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 1.0 XLM/);
    expect(screen.queryByText("GABC123")).not.toBeInTheDocument();
  });

  it("hides the picker when only XLM is enabled", () => {
    view([XLM]);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByText("GABC123")).toBeInTheDocument();
  });
});
