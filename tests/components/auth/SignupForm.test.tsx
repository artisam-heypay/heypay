import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(auth)/actions", () => ({ signupAction: vi.fn(async () => ({})) }));

import { SignupForm } from "@/components/auth/SignupForm";

const google = () => screen.queryByRole("link", { name: "Continue with Google" });

describe("SignupForm", () => {
  it("offers Google and email when both are set up", () => {
    render(<SignupForm googleEnabled emailEnabled notice={null} />);
    expect(google()).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
  });

  it("sends Google the role the person picked", async () => {
    render(<SignupForm googleEnabled emailEnabled notice={null} />);
    expect(google()).toHaveAttribute("href", "/api/auth/google/start?role=PAYER");
    await userEvent.click(screen.getByText("Merchant"));
    expect(google()).toHaveAttribute("href", "/api/auth/google/start?role=MERCHANT");
  });

  it("leaves the email fields out when no code could be emailed", () => {
    render(<SignupForm googleEnabled emailEnabled={false} notice={null} />);
    expect(google()).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Password/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.queryByText(/or use your email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves Google out when it is not set up", () => {
    render(<SignupForm googleEnabled={false} emailEnabled notice={null} />);
    expect(google()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("says so when there is no way to sign up at all", () => {
    render(<SignupForm googleEnabled={false} emailEnabled={false} notice={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-up is not available right now");
  });

  it("shows why a Google sign-in sent the person back", () => {
    render(
      <SignupForm googleEnabled emailEnabled={false} notice="Google sign-in was cancelled." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Google sign-in was cancelled.");
  });
});
