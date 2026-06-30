// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChangePasswordForm } from "./ChangePasswordForm";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

function fill(
  getByLabelText: (t: RegExp) => HTMLElement,
  cur: string,
  next: string,
  confirm: string,
) {
  fireEvent.change(getByLabelText(/current password/i), { target: { value: cur } });
  fireEvent.change(getByLabelText(/^new password/i), { target: { value: next } });
  fireEvent.change(getByLabelText(/confirm new password/i), { target: { value: confirm } });
}

describe("ChangePasswordForm", () => {
  it("blocks submit on a new/confirm mismatch with an inline error", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { getByLabelText, getByRole, getByText } = render(<ChangePasswordForm />);
    fill(getByLabelText, "oldpass12", "brandnew12", "different12");
    fireEvent.click(getByRole("button", { name: /update password/i }));
    expect(getByText(/don.t match/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears the form and announces success on a 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 204 }));
    const { getByLabelText, getByRole, getByText } = render(<ChangePasswordForm />);
    fill(getByLabelText, "oldpass12", "brandnew12", "brandnew12");
    fireEvent.click(getByRole("button", { name: /update password/i }));
    await waitFor(() => expect(getByText(/password updated/i)).toBeTruthy());
    expect((getByLabelText(/^new password/i) as HTMLInputElement).value).toBe("");
  });

  it("shows the server error message on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 401,
        json: async () => ({
          error: { code: "unauthorized", message: "Current password is incorrect" },
        }),
      }),
    );
    const { getByLabelText, getByRole, getByText } = render(<ChangePasswordForm />);
    fill(getByLabelText, "wrongpass", "brandnew12", "brandnew12");
    fireEvent.click(getByRole("button", { name: /update password/i }));
    await waitFor(() => expect(getByText(/current password is incorrect/i)).toBeTruthy());
  });
});
