import type { NextConfig } from "next";

// Standalone Tauri build: static export, no server. API routes are being replaced by
// the local ingest sidecar (see docs/ and tasks 6b-6d). PostHog/analytics removed —
// this ships as a downloadable mod with no phone-home.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Emit every route as <route>/index.html so the Tauri asset protocol (which has no
  // clean-URL rewrite) can resolve client navigations like /current/coach reliably.
  trailingSlash: true,
};

export default nextConfig;
