/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatCard } from "@/components/admin/StatCard";

describe("StatCard", () => {
  it("renders label, value, and uses a rounded-lg data surface", () => {
    const { container } = render(<StatCard label="Total Payments" value="1,204" icon="payments" />);
    expect(screen.getByText("Total Payments")).toBeInTheDocument();
    expect(screen.getByText("1,204")).toBeInTheDocument();
    expect(container.querySelector(".rounded-lg")).toBeTruthy();
    expect(container.querySelector(".rounded-full")).toBeNull();
  });
});
