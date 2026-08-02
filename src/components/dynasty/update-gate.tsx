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
//
// THE HALF THAT WAS MISSING: `update_apply` swaps the exe and relaunches, so this component
// is destroyed mid-sentence — there is no "done" to render, and a tester reported exactly
// that ("the application refreshes itself but I don't see anything to verify the update").
// Worse, the interesting failure is silent: if the swap doesn't take, the new process comes
// up on the OLD version and looks identical to success. So the intent is written down before
// the relaunch and checked on the way back up, which covers both.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { LazyStore } from "@tauri-apps/plugin-store";
import { Check, Download, TriangleAlert, X } from "lucide-react";
import { setUpdateHold } from "@/lib/dynasty/update-hold";
import { cn } from "@/lib/utils";

type Phase = "idle" | "available" | "installing" | "failed" | "landed" | "stalled";

/** Shape returned by the Rust `update_check` command. */
interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
  signature: string;
}

/** Written immediately before the relaunch, read by the process that comes back. */
interface PendingUpdate {
  from: string;
  to: string;
  notes: string;
  at: number;
}

const MANIFEST = "https://github.com/CaMoSTEEL1/DynastyWire/releases/latest/download/latest.json";
const store = new LazyStore("dynastywire.update.json");
const PENDING = "pending";
/** How long the "you're on the new version" note stays up before it gets out of the way. */
const CONFIRM_MS = 15000;

export default function UpdateGate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dismissed, setDismissed] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  /** What we were trying to become, when we didn't. */
  const [expected, setExpected] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await getVersion().catch(() => null);
      if (cancelled || !current) return;
      setVersion(current);

      // Did we just come back from an update? Read it once and clear it, so a stale record
      // can never announce the same update on every future launch.
      try {
        const pending = await store.get<PendingUpdate>(PENDING);
        if (pending) {
          await store.delete(PENDING);
          await store.save();
          if (!cancelled) {
            if (pending.to === current) {
              setNotes(pending.notes ?? "");
              setPhase("landed");
              return; // don't also check for a newer one in the same breath
            }
            // Came back up on the version we started from: the swap didn't take. Silence
            // here would leave the user believing they had updated.
            setExpected(pending.to);
            setPhase("stalled");
            return;
          }
        }
      } catch {
        // No store, no confirmation — not a reason to break the update check below.
      }

      try {
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

  // The confirmation is news for a moment, then it's clutter.
  useEffect(() => {
    if (phase !== "landed") return;
    const t = setTimeout(() => setDismissed(true), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Hold the eager weekly pass while this is on screen. An unanswered prompt is a restart
  // waiting to happen, and anything generated between now and then is paid for and lost.
  // Dismissing, declining or failing all release it immediately; "installing" keeps it,
  // because that IS the restart. Released on unmount so a hold can never outlive the prompt.
  const pending = !dismissed && (phase === "available" || phase === "installing");
  useEffect(() => {
    setUpdateHold(pending);
    return () => setUpdateHold(false);
  }, [pending]);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase("installing");
    setWhy(null);
    try {
      // Record the intent BEFORE the swap. From here the process can vanish at any moment,
      // and this note is the only thing that survives to tell the next one what happened.
      await store.set(PENDING, {
        from: version ?? "unknown",
        to: update.version,
        notes: update.notes ?? "",
        at: Date.now(),
      } satisfies PendingUpdate);
      await store.save();
    } catch {
      // A missing note costs a confirmation, not the update. Carry on.
    }
    try {
      // Downloads, verifies the signature, swaps the .exe and relaunches. On success this
      // process is already exiting, so there is no success state to render here — the
      // "landed" branch above is where the user finally sees it.
      await invoke("update_apply", { info: update });
    } catch (e) {
      setWhy(typeof e === "string" ? e : e instanceof Error ? e.message : null);
      setPhase("failed");
      // It never restarted, so the pending note would misfire on the next launch.
      await store.delete(PENDING).then(() => store.save()).catch(() => {});
    }
  }, [update, version]);

  const showing =
    !dismissed &&
    (phase === "landed" || phase === "stalled" || (!!update && phase !== "idle"));
  if (!showing) return null;

  const releaseNotes = (phase === "landed" ? notes : update?.notes ?? "").trim();

  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-4 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded p-3 shadow-lg",
        "border bg-paper2",
        phase === "landed" ? "border-dw-green/50" : phase === "stalled" ? "border-dw-yellow/50" : "border-dw-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-wider text-ink">
          {phase === "landed" && <Check className="h-3.5 w-3.5 shrink-0 text-dw-green" />}
          {phase === "stalled" && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-dw-yellow" />}
          {phase === "landed"
            ? `Updated — now on ${version}`
            : phase === "stalled"
              ? "Update didn't apply"
              : `Version ${update?.version} available`}
        </p>
        {phase !== "installing" && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
            className="text-ink2 transition-colors hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {releaseNotes && (phase === "available" || phase === "landed") && (
        <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-line text-[11px] leading-relaxed text-ink2">
          {releaseNotes}
        </p>
      )}

      {phase === "installing" && (
        <p className="mt-1 text-[11px] leading-relaxed text-ink2">
          Downloading and verifying — the app restarts on its own when it&apos;s done, and
          confirms the new version when it comes back.
        </p>
      )}

      {phase === "stalled" && (
        <p className="mt-1 text-[11px] leading-relaxed text-ink2">
          {expected} was downloaded but the swap didn&apos;t take — you&apos;re still on {version}.
          Nothing was damaged; it&apos;ll offer again next launch. If it keeps happening, the
          file is probably locked by something (antivirus, or a second copy running).
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
              "flex items-center gap-1.5 rounded border border-paper4 bg-paper3 px-3 py-1.5",
              "font-sans text-[11px] uppercase tracking-wider text-ink2 transition-colors",
              "hover:border-ink3 hover:bg-paper4 hover:text-ink"
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
            className="font-sans text-[11px] uppercase tracking-wider text-ink2 transition-colors hover:text-ink"
          >
            {phase === "available" ? "Not now" : "Dismiss"}
          </button>
        )}
      </div>
    </div>
  );
}
