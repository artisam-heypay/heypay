// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SetupBanner } from "@/components/merchant/SetupBanner";

const { path } = vi.hoisted(() => ({ path: { current: "/merchant/dashboard" } }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

afterEach(cleanup);

const INCOMPLETE = {
  hasBusiness: true,
  hasSettlement: false,
  hasQrph: false,
  isComplete: false,
};
const COMPLETE = { hasBusiness: true, hasSettlement: true, hasQrph: true, isComplete: true };

describe("SetupBanner", () => {
  it("prompts an incomplete merchant to finish onboarding", () => {
    path.current = "/merchant/dashboard";
    const { getByText, getByRole } = render(<SetupBanner setup={INCOMPLETE} />);
    expect(getByText("Finish setting up your business")).toBeTruthy();
    expect(getByRole("link", { name: /Complete onboarding/i })).toBeTruthy();
    expect(getByText("Settlement account")).toBeTruthy();
  });

  it("renders nothing when setup is complete", () => {
    path.current = "/merchant/dashboard";
    const { container } = render(<SetupBanner setup={COMPLETE} />);
    expect(container.firstChild).toBeNull();
  });

  it("self-suppresses on the onboarding route", () => {
    path.current = "/merchant/onboarding";
    const { container } = render(<SetupBanner setup={INCOMPLETE} />);
    expect(container.firstChild).toBeNull();
  });
});
