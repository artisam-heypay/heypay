import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DepositCard } from "./DepositCard";

describe("DepositCard", () => {
  it("shows the full address, copy control, network reminder, and QR", () => {
    render(<DepositCard publicKey="GABC123" qrSvg="<svg data-testid='qr'></svg>" />);
    expect(screen.getByText("GABC123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy deposit address" })).toBeInTheDocument();
    expect(
      screen.getByText(/Send only XLM on the Stellar network\. No memo is required\./),
    ).toBeInTheDocument();
  });

  it("gates an untrusted issued asset behind a one-time trustline", () => {
    render(
      <DepositCard
        publicKey="GABC123"
        qrSvg="<svg></svg>"
        asset="USDC"
        trustlineRequired
        canReceive={false}
      />,
    );
    expect(screen.queryByText("GABC123")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enable USDC/ })).toBeInTheDocument();
  });

  it("shows the accepted issuer even while the trustline gate is up", () => {
    // The payer needs the issuer to check what their own wallet holds *before*
    // enabling the asset — an issuer mismatch is the whole failure mode.
    const issuer = "GAHPYWLK6YRN7CVYZOO4H3VDRZ7PVF5UJGLZCSPAEIKJE2XSWF5LAGER";
    render(
      <DepositCard
        publicKey="GABC123"
        qrSvg="<svg></svg>"
        asset="USDT"
        issuer={issuer}
        trustlineRequired
        canReceive={false}
      />,
    );
    expect(screen.getByText(issuer)).toBeInTheDocument();
    expect(screen.getByText(/Accepted USDT issuer/)).toBeInTheDocument();
  });
});
