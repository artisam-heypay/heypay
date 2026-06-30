// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OnboardingWizard } from "@/components/merchant/onboarding/OnboardingWizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/merchant/onboarding",
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ merchant: { id: "m1", businessName: "Bean Co" } }), {
          status: 201,
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OnboardingWizard", () => {
  it("shows 4 progress segments and a live preview that updates as you type", () => {
    render(<OnboardingWizard initial={null} />);
    expect(screen.getAllByTestId("progress-seg")).toHaveLength(4);
    const input = screen.getByLabelText(/Business name/i);
    fireEvent.change(input, { target: { value: "Bean Co" } });
    expect(screen.getByTestId("preview-name").textContent).toContain("Bean Co");
  });

  it("calls POST /api/merchant on step 1 continue", async () => {
    render(<OnboardingWizard initial={null} />);
    fireEvent.change(screen.getByLabelText(/Business name/i), { target: { value: "Bean Co" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(fetch).toHaveBeenCalledWith(
      "/api/merchant",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
