// Extends Vitest's `expect` with @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// and unmounts React trees between tests so queries don't see stale DOM.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});
