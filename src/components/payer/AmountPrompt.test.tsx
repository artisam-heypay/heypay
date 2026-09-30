import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AmountPrompt } from "./AmountPrompt";

function mockWallet(rate: string | null, available = "50.0000000") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assets: [{ asset: "XLM", rate, available }] }),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("AmountPrompt", () => {
  it("submits a PHP amount as-is and previews the XLM cost", async () => {
    mockWallet("20.00000000");
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "100" } });
    expect(screen.getByText("≈ 5.0000000 XLM")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(onSubmit).toHaveBeenCalledWith("100.00");
  });

  it("converts an XLM amount to PHP before submitting", async () => {
    mockWallet("20.00000000");
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.click(screen.getByRole("radio", { name: "XLM" }));
    fireEvent.change(screen.getByLabelText("Amount to pay (XLM)"), { target: { value: "2.5" } });
    expect(screen.getByText("≈ ₱50.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(onSubmit).toHaveBeenCalledWith("50.00");
  });

  it("carries the amount across when switching currency", async () => {
    mockWallet("20.00000000");
    render(<AmountPrompt onSubmit={vi.fn()} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("radio", { name: "XLM" }));
    expect(screen.getByLabelText("Amount to pay (XLM)")).toHaveValue("5.0000000");
  });

  it("warns when the amount exceeds the available XLM", async () => {
    mockWallet("20.00000000", "1.0000000");
    render(<AmountPrompt onSubmit={vi.fn()} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "100" } });
    expect(screen.getByText("This is more than your available XLM.")).toBeInTheDocument();
  });

  it("refuses XLM entry when no rate is available", async () => {
    mockWallet(null);
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("radio", { name: "XLM" }));
    fireEvent.change(screen.getByLabelText("Amount to pay (XLM)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/XLM rate is unavailable/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
