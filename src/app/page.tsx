"use client";

// Standalone app entry: route straight into the single local dynasty. Onboarding
// (save folder, team, API key) is handled inside the dynasty shell.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/current");
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center text-lg opacity-70">
      Loading Dynasty Wire…
    </div>
  );
}
