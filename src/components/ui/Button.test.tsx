// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Button } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("primary-pill renders a button with rounded-full and an accessible name", () => {
    const { getByRole } = render(<Button variant="primary-pill">Pay now</Button>);
    const btn = getByRole("button", { name: "Pay now" });
    expect(btn.className).toContain("rounded-full");
  });

  it("loading disables the button and sets aria-busy", () => {
    const { getByRole } = render(<Button loading>Pay</Button>);
    const btn = getByRole("button") as HTMLButtonElement;
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.disabled).toBe(true);
  });

  it("renders the trailing icon", () => {
    const { getByText } = render(<Button trailingIcon="arrow_forward">Next</Button>);
    expect(getByText("arrow_forward")).toBeTruthy();
  });
});
