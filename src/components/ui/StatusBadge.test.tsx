// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders SETTLED as text 'Settled' with a dot (not color alone)", () => {
    const { getByText, getByTestId } = render(<StatusBadge status="SETTLED" />);
    expect(getByText("Settled")).toBeTruthy();
    expect(getByTestId("status-dot")).toBeTruthy();
  });

  it("renders PENDING as 'Pending' with a pulsing dot", () => {
    const { getByText, getByTestId } = render(<StatusBadge status="PENDING" />);
    expect(getByText("Pending")).toBeTruthy();
    expect(getByTestId("status-dot").className).toContain("animate-status-pulse");
  });

  it("renders FAILED as 'Failed' in error styling", () => {
    const { getByText, container } = render(<StatusBadge status="FAILED" />);
    expect(getByText("Failed")).toBeTruthy();
    expect(container.querySelector(".text-error")).toBeTruthy();
  });
});
