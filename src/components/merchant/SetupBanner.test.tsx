import { render, screen } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/merchant/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { SetupBanner } from "./SetupBanner";

const INCOMPLETE = { hasBusiness: true, hasSettlement: false, hasQrph: false, isComplete: false };

beforeEach(() => {
  nav.pathname = "/merchant/dashboard";
});

it("shows the banner + onboarding CTA when setup is incomplete", () => {
  render(<SetupBanner setup={INCOMPLETE} />);
  expect(screen.getByText("Finish setting up your business")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Complete onboarding/i })).toHaveAttribute(
    "href",
    "/merchant/onboarding",
  );
});

it("renders nothing when setup is complete", () => {
  const { container } = render(
    <SetupBanner
      setup={{ hasBusiness: true, hasSettlement: true, hasQrph: true, isComplete: true }}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("is not shown on the onboarding page it links to", () => {
  nav.pathname = "/merchant/onboarding";
  const { container } = render(<SetupBanner setup={INCOMPLETE} />);
  expect(container).toBeEmptyDOMElement();
});
