import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi, beforeEach } from "vitest";
import { OnboardingWizard } from "@/components/merchant/onboarding/OnboardingWizard";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
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

it("calls POST /api/merchant on step 1 continue, then refreshes the layout", async () => {
  render(<OnboardingWizard initial={null} />);
  fireEvent.change(screen.getByLabelText(/Business name/i), { target: { value: "Bean Co" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  expect(fetch).toHaveBeenCalledWith("/api/merchant", expect.objectContaining({ method: "POST" }));
  await screen.findByRole("heading", { name: "Settlement account" });
  expect(router.refresh).toHaveBeenCalled();
});

it("says next to the field what is wrong, without calling the API", async () => {
  render(<OnboardingWizard initial={null} />);
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  const input = screen.getByLabelText(/Business name/i);
  expect(await screen.findByText(/Enter your business name/)).toBeInTheDocument();
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByText("Validation failed.")).not.toBeInTheDocument();
});

it("marks each settlement field the merchant left wrong", async () => {
  render(
    <OnboardingWizard
      initial={
        { id: "m1", businessName: "Bean Co" } as Parameters<typeof OnboardingWizard>[0]["initial"]
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  await screen.findByRole("heading", { name: "Settlement account" });
  vi.mocked(fetch).mockClear();

  fireEvent.change(screen.getByLabelText(/Account number/i), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

  expect(await screen.findByText(/Choose the bank or e-wallet/)).toBeInTheDocument();
  expect(screen.getByText(/Enter the name on the account/)).toBeInTheDocument();
  expect(screen.getByText(/6 to 20 digits/)).toBeInTheDocument();
  expect(screen.getByText(/Enter a valid email/)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("lists GCash and Maya first, and names each bank without overflowing", () => {
  render(
    <OnboardingWizard
      initial={
        { id: "m1", businessName: "Bean Co" } as Parameters<typeof OnboardingWizard>[0]["initial"]
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  return screen.findAllByRole("radio").then((radios) => {
    expect(radios.slice(0, 2).map((r) => (r as HTMLInputElement).value)).toEqual(["GCASH", "MAYA"]);
    expect(screen.getByRole("radio", { name: /BPI/ })).toBeInTheDocument();
  });
});
