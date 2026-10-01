import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";
import { OnboardingWizard } from "@/components/merchant/onboarding/OnboardingWizard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

it("shows 4 progress segments and a live preview that updates as you type", () => {
  render(<OnboardingWizard initial={null} />);
  expect(screen.getAllByTestId("progress-seg")).toHaveLength(4);
  const input = screen.getByLabelText(/Business name/i);
  fireEvent.change(input, { target: { value: "Bean Co" } });
  expect(screen.getByTestId("preview-name")).toHaveTextContent("Bean Co");
});

it("calls POST /api/merchant on step 1 continue", async () => {
  render(<OnboardingWizard initial={null} />);
  fireEvent.change(screen.getByLabelText(/Business name/i), { target: { value: "Bean Co" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  expect(fetch).toHaveBeenCalledWith("/api/merchant", expect.objectContaining({ method: "POST" }));
});
