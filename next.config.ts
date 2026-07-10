import type { NextConfig } from "next";

// Standalone Tauri build: static export, no server. API routes are being replaced by
// the local ingest sidecar (see docs/ and tasks 6b-6d). PostHog/analytics removed —
// this ships as a downloadable mod with no phone-home.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
