import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { SetupBanner } from "./SetupBanner";

it("shows the banner + onboarding CTA when setup is incomplete", () => {
  render(
    <SetupBanner
      setup={{ hasBusiness: true, hasSettlement: false, hasQrph: false, isComplete: false }}
    />,
  );
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
