import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangePasswordForm } from "./ChangePasswordForm";

describe("ChangePasswordForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks submit when new and confirm mismatch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ChangePasswordForm />);
    await userEvent.type(screen.getByLabelText("Current password"), "oldpassword");
    await userEvent.type(screen.getByLabelText("New password"), "newpassword1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "different123");
    await userEvent.click(screen.getByRole("button", { name: /Update password/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/do not match/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears fields and shows success on 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    render(<ChangePasswordForm />);
    await userEvent.type(screen.getByLabelText("Current password"), "oldpassword");
    await userEvent.type(screen.getByLabelText("New password"), "newpassword1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "newpassword1");
    await userEvent.click(screen.getByRole("button", { name: /Update password/ }));
    expect(await screen.findByText("Password updated.")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("");
  });
});
