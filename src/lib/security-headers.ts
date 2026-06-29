// Strict CSP. Google Fonts CSS is served from fonts.googleapis.com (style) and the
// Material Symbols + Lexend/Inter font files from fonts.gstatic.com (font).
// 'unsafe-inline' is limited to style-src (Next injects a few inline <style> tags);
// scripts stay 'self' only. img-src allows data:/blob: for generated QR codes and
// https: for signed object-storage URLs.
export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
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
