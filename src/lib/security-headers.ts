// CSP. Google Fonts CSS from fonts.googleapis.com (style) and font files from
// fonts.gstatic.com (font). Next.js App Router injects inline bootstrap/hydration
// scripts, so script-src must permit inline (via 'unsafe-inline'); dev additionally
// needs 'unsafe-eval' (react-refresh/HMR) and a ws: connect-src for the HMR socket.
// img-src allows data:/blob: for generated QR codes and https: for signed object URLs.
// worker-src blob: lets PostHog session replay run its compression worker.
// NOTE: 'unsafe-inline' for scripts is a known trade-off; a nonce/'strict-dynamic'
// CSP (nonce generated in proxy.ts per request) is the stricter hardening follow-up.
export function buildCsp(): string {
  const dev = process.env.NODE_ENV !== "production";
  const scriptSrc = ["'self'", "'unsafe-inline'", dev ? "'unsafe-eval'" : ""]
    .filter(Boolean)
    .join(" ");
  const connectSrc = ["'self'", dev ? "ws: http://localhost:*" : ""].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function applySecurityHeaders(res: { headers: Headers }): void {
  res.headers.set("Content-Security-Policy", buildCsp());
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");

  // Only the payer QR scanner uses the camera, but this header cannot be scoped to
  // its route: a policy binds to the document, and reaching /payer/scan through a
  // client-side link keeps the document (and its camera=()) of the page you came
  // from, so the scanner failed unless /payer/scan was loaded directly. 'self'
  // still keeps the camera away from third-party frames, and the browser still
  // asks the user before any page can open it.
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
}
