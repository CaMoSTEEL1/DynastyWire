"use client";

// Self-update for a single portable .exe — no installer anywhere in the flow.
//
// Tauri's own updater can't do this on Windows: it only applies NSIS/MSI artifacts, which
// would install a second copy beside the portable file instead of replacing it. So the
// swap lives in Rust (`update_apply`), and this is just the prompt in front of it.
//
// Deliberately quiet and always declinable. An update that interrupts a dynasty week is
// worse than one that waits, and a silent forced restart is how you get uninstalled.
// Nothing here blocks the app: a failed check is a no-op.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Download, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Phase = "idle" | "available" | "installing" | "failed";

/** Shape returned by the Rust `update_check` command. */
interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
  signature: string;
}

const MANIFEST = "https://github.com/CaMoSTEEL1/DynastyWire/releases/latest/download/latest.json";

export default function UpdateGate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dismissed, setDismissed] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getVersion();
        const found = await invoke<UpdateInfo | null>("update_check", {
          endpoint: MANIFEST,
          current,
        });
        if (!cancelled && found) {
          setUpdate(found);
          setPhase("available");
        }
      } catch {
        // Offline, GitHub down, or nothing published yet — none of that is the user's
        // problem and none of it should surface. The app works without updating.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase("installing");
    setWhy(null);
    try {
      // Downloads, verifies the signature, swaps the .exe and relaunches. On success this
      // process is already exiting, so there is no success state to render.
      await invoke("update_apply", { info: update });
    } catch (e) {
      setWhy(typeof e === "string" ? e : e instanceof Error ? e.message : null);
      setPhase("failed");
    }
  }, [update]);

  if (!update || dismissed || phase === "idle") return null;

  const notes = (update.notes ?? "").trim();

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded border border-dw-border bg-paper2 p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink">
          Version {update.version} available
        </p>
        {phase !== "installing" && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="text-ink3 transition-colors hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {notes && phase === "available" && (
        <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-line text-[11px] leading-relaxed text-ink3">
          {notes}
        </p>
      )}

      {phase === "installing" && (
        <p className="mt-1 text-[11px] leading-relaxed text-ink3">
          Downloading and verifying — the app restarts on its own when it&apos;s done.
        </p>
      )}

      {phase === "failed" && (
        <p className="mt-1 text-[11px] leading-relaxed text-dw-red">
          {why ?? "Update failed."} Nothing was changed — it&apos;ll try again next launch.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {phase === "available" && (
          <button
            type="button"
            onClick={install}
            className={cn(
              "flex items-center gap-1.5 rounded border border-dw-border px-3 py-1.5",
              "font-sans text-[11px] uppercase tracking-wider text-ink2 hover:bg-paper3"
            )}
          >
            <Download className="h-3 w-3" />
            Update &amp; restart
          </button>
        )}
        {phase !== "installing" && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="font-sans text-[11px] uppercase tracking-wider text-ink3 hover:text-ink"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
