import { vi } from "vitest";

// In-memory cookie jar shared by createSession / getSessionUser / destroySession under test.
const jar = new Map<string, string>();

export const cookieJar = {
  get: (name: string) => {
    const value = jar.get(name);
    return value === undefined ? undefined : { name, value };
  },
  set: (name: string, value: string) => jar.set(name, value),
  delete: (name: string) => jar.delete(name),
  clear: () => jar.clear(),
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => cookieJar.get(n),
    // Real Next signature is set(name, value, options) — extra args ignored here.
    set: (n: string, v: string, _opts?: unknown) => cookieJar.set(n, v),
    delete: (n: string) => cookieJar.delete(n),
  }),
  headers: async () => new Headers(),
}));
