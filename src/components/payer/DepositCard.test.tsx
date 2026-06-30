// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DepositCard } from "./DepositCard";

afterEach(cleanup);

const PUBLIC_KEY = "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD";
const QR_SVG = '<svg data-testid="qr"><rect /></svg>';

describe("DepositCard", () => {
  it("shows the full address, a copy button, the network reminder, and the QR", () => {
    const { container, getByText, getByRole } = render(
      <DepositCard publicKey={PUBLIC_KEY} qrSvg={QR_SVG} />,
    );
    expect(getByText(PUBLIC_KEY)).toBeTruthy();
    expect(getByRole("button", { name: /copy deposit address/i })).toBeTruthy();
    expect(container.textContent).toContain("Stellar network · No memo required");
    expect(container.querySelector('[data-testid="qr"]')).toBeTruthy();
  });
});
