/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserActiveToggle } from "@/components/admin/UserActiveToggle";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ isActive: false }), { status: 200 })),
  );
});

describe("UserActiveToggle", () => {
  it("PATCHes the user with same-origin credentials and flips the label", async () => {
    render(<UserActiveToggle id="u1" isActive={true} username="alice" />);
    fireEvent.click(screen.getByRole("button", { name: /deactivate/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/users/u1",
        expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /activate/i })).toBeInTheDocument(),
    );
  });
});
