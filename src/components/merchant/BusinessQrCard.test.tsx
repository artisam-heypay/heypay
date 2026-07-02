import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { BusinessQrCard } from "./BusinessQrCard";

it("renders the QR, payment link, and copy/download actions", () => {
  render(
    <BusinessQrCard
      qrSvg="<svg data-testid='qr'></svg>"
      paymentLink="http://localhost:3000/pay?m=m1"
      businessName="Bean Co"
    />,
  );
  expect(screen.getByText("My Business QR")).toBeInTheDocument();
  expect(screen.getByText("http://localhost:3000/pay?m=m1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Copy link/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Download/i })).toBeInTheDocument();
});
