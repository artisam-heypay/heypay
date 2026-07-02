/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminSideNav } from "@/components/admin/AdminSideNav";

describe("AdminSideNav", () => {
  it("renders every admin destination and marks the active one with aria-current", () => {
    render(<AdminSideNav active="payments" />);
    for (const label of ["Overview", "Users", "Merchants", "Payments", "Health"]) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /payments/i })).toHaveAttribute("aria-current", "page");
  });

  it("uses rounded-lg data surfaces (no consumer pills) for nav items", () => {
    const { container } = render(<AdminSideNav active="overview" />);
    expect(container.querySelector(".rounded-lg")).toBeTruthy();
    expect(container.querySelector(".rounded-full")).toBeNull();
  });
});
