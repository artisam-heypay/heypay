import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsForms } from "@/components/merchant/SettingsForms";

const merchant = {
  id: "m1",
  businessName: "Bean Co",
  logoKey: null,
  status: "ACTIVE",
  qrphRaw: "RAW",
  qrphMerchantName: "BEAN CO",
  qrphMerchantCity: "CEBU",
  qrphMerchantId: "M1",
  qrphImageKey: null,
  qrphCountry: "PH",
  qrphCurrency: "608",
  settlementBankCode: "BPI",
  settlementBankName: "Bank of the Philippine Islands",
  accountName: "Ana",
  accountNumberLast4: "7890",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
} as const;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ merchant }), { status: 200 })),
  );
});

describe("SettingsForms", () => {
  it("shows current last4 masked and PATCHes the business name", async () => {
    render(<SettingsForms merchant={merchant} />);

    expect(screen.getByText(/•••• 7890/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Business name/i), {
      target: { value: "New Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save business/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/merchant/me",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("renders all four settings sections", () => {
    render(<SettingsForms merchant={merchant} />);

    expect(screen.getByRole("heading", { name: /Business identity/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Settlement account/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /QRPH/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Change password/i })).toBeInTheDocument();
  });
});
