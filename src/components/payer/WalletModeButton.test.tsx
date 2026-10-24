import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { WalletModeButton } from "./WalletModeButton";

const OWN = "GDY2RNPWRZCEROBS2YJIHG7QDXVJ7VNF7XTFL2R4GJO4OAWI3LQ7UBH6";

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("WalletModeButton", () => {
  it("switches the wallet that pays and draws the page again", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ walletMode: "CUSTODIAL", externalPublicKey: OWN })),
    );
    render(<WalletModeButton to="CUSTODIAL">Use this wallet</WalletModeButton>);

    await userEvent.click(screen.getByRole("button", { name: "Use this wallet" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/wallet/external");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ walletMode: "CUSTODIAL" });
  });

  it("says why when the switch is refused, and stays on the page", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Connect your wallet first." } }), {
        status: 409,
      }),
    );
    render(<WalletModeButton to="EXTERNAL">Use this wallet</WalletModeButton>);

    await userEvent.click(screen.getByRole("button", { name: "Use this wallet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connect your wallet first.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
