import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TEST_SHOP_QR_PATH, TestShopQrCard } from "./TestShopQrCard";

describe("TestShopQrCard", () => {
  it("shows the test shop QR and offers it as a download", () => {
    render(<TestShopQrCard />);
    expect(screen.getByAltText("QRPH code for the HeyPay Test Shop")).toHaveAttribute(
      "src",
      TEST_SHOP_QR_PATH,
    );
    const link = screen.getByRole("link", { name: /Download QR/ });
    expect(link).toHaveAttribute("href", TEST_SHOP_QR_PATH);
    expect(link).toHaveAttribute("download", "heypay-test-shop.png");
  });
});
