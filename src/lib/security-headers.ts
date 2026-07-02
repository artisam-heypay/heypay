// CSP. Google Fonts CSS from fonts.googleapis.com (style) and font files from
// fonts.gstatic.com (font). Next.js App Router injects inline bootstrap/hydration
// scripts, so script-src must permit inline (via 'unsafe-inline'); dev additionally
// needs 'unsafe-eval' (react-refresh/HMR) and a ws: connect-src for the HMR socket.
// img-src allows data:/blob: for generated QR codes and https: for signed object URLs.
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
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function applySecurityHeaders(res: { headers: Headers }, pathname: string): void {
  res.headers.set("Content-Security-Policy", buildCsp());
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");

  // Camera is required only by the payer QR scanner; deny it everywhere else.
  const camera = pathname === "/payer/scan" ? "camera=(self)" : "camera=()";
  res.headers.set("Permissions-Policy", `${camera}, microphone=(), geolocation=()`);
}
