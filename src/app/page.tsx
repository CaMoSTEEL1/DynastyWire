"use client";

// Standalone app entry: route straight into the single local dynasty. Onboarding
// (save folder, team, API key) is handled inside the dynasty shell.
// Hard redirect (window.location, not the Next router): client-side routing is unreliable
// over Tauri's asset protocol, and /current/ has its own index.html to land on.
import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    window.location.replace("/current/");
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center text-lg opacity-70">
      Loading Dynasty Wire…
    </div>
  );
}
