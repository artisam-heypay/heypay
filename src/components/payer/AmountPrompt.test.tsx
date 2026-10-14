import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AmountPrompt } from "./AmountPrompt";

afterEach(() => vi.unstubAllGlobals());

function type(value: string) {
  fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
}

describe("AmountPrompt", () => {
  it("submits the PHP amount to the centavo", () => {
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);
    type("100");
    expect(onSubmit).toHaveBeenCalledWith("100.00");
  });

  it("asks for pesos only: no currency to pick, no balance, nothing asked of the wallet", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AmountPrompt onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "150" } });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/XLM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Available/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an empty or zero amount", () => {
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);
    type("");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount greater than zero.");
    type("0");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount greater than zero.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses more than two decimal places", () => {
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);
    type("50.123");
    expect(screen.getByRole("alert")).toHaveTextContent("Use at most 2 decimal places.");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
