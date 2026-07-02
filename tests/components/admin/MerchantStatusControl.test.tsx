/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MerchantStatusControl } from "@/components/admin/MerchantStatusControl";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: "ACTIVE" }), { status: 200 })),
  );
});

describe("MerchantStatusControl", () => {
  it("activates a PENDING_REVIEW merchant via PATCH and reflects the new badge", async () => {
    render(<MerchantStatusControl id="m1" status="PENDING_REVIEW" />);
    fireEvent.click(screen.getByRole("button", { name: /activate/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/merchants/m1",
        expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/active/i)).toBeInTheDocument());
  });
});
