"use client";

// The moment a dynasty stops being private.
//
// This screen has one job beyond the button: make the decision informed. The app has told
// every user "Nothing leaves your machine" since the first release, so publishing is a real
// change to that promise and it is never going to be a toggle the user flips by accident.
// Before anything uploads it says, in specifics rather than reassurance, exactly which
// sections travel and which stay — and it shows the count of what is being held back, drawn
// from the same allowlist that does the holding.

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { listIssues } from "@/lib/dynasty/issue-cache";
import { PUBLIC_KINDS, buildBundle, kindOf } from "@/lib/share/bundle";
import { usernameFromPath } from "@/lib/share/redact";
import { DEFAULT_FORUM_URL, publishDynasty, unpublishDynasty } from "@/lib/share/api";
import { allTokens, loadPublishState, savePublishState, type PublishState } from "@/lib/share/publish-store";
import { Globe, Lock, Loader2, ExternalLink } from "lucide-react";

const SECTIONS_PUBLIC = ["Front page", "Around the league", "National desk", "Social", "Rankings", "Shows", "Trophy room"];
const SECTIONS_PRIVATE = ["Press conference answers", "Private messages & your phone", "NIL and the money", "Gameplans & the recruiting board", "Situation room"];

export function PublishPanel() {
  const { dynastyId, snapshot, settings, activeProfile } = useDynasty();
  const [state, setState] = useState<PublishState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [held, setHeld] = useState<{ publicTabs: number; privateTabs: number; weeks: number } | null>(null);

  const forumUrl = settings.forumUrl || DEFAULT_FORUM_URL;

  useEffect(() => {
    let cancelled = false;
    void loadPublishState(dynastyId).then((s) => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, [dynastyId]);

  // Count what would travel and what would not, from the real cache — so the numbers on
  // screen are the ones the allowlist will actually produce, not a description of them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const issues = await listIssues(dynastyId).catch(() => []);
      if (cancelled) return;
      let pub = 0;
      let priv = 0;
      const weeks = new Set<string>();
      for (const issue of issues) {
        let anyPublic = false;
        for (const key of Object.keys(issue.tabs ?? {})) {
          if (PUBLIC_KINDS.has(kindOf(key))) { pub++; anyPublic = true; } else priv++;
        }
        if (anyPublic) weeks.add(`${issue.year}::${issue.week}`);
      }
      setHeld({ publicTabs: pub, privateTabs: priv, weeks: weeks.size });
    })();
    return () => { cancelled = true; };
  }, [dynastyId]);

  const identity = useMemo(
    () => ({
      handle: (settings.forumHandle || activeProfile?.userTeam || snapshot?.userTeam?.name || "anonymous").trim(),
      title: activeProfile?.label || snapshot?.userTeam?.name || "A dynasty",
      mode: (snapshot?.mode === "rtg" ? "rtg" : "dynasty") as "dynasty" | "rtg",
    }),
    [settings.forumHandle, activeProfile?.userTeam, activeProfile?.label, snapshot?.userTeam?.name, snapshot?.mode]
  );

  const publish = useCallback(async () => {
    if (busy || !state) return;
    setBusy(true);
    setErr(null);
    try {
      const issues = await listIssues(dynastyId);
      // Everything this machine knows to be secret goes to the redactor: the API keys, the
      // save paths (which carry the OS username), and every publish token we hold.
      const secrets = [
        settings.anthropicKey, settings.openaiKey, settings.elevenLabsKey,
        settings.savesFolder, activeProfile?.saveFile, ...(await allTokens()),
      ].filter((s): s is string => typeof s === "string" && s.length > 0);

      const { bundle, leaks } = buildBundle({
        handle: identity.handle,
        title: identity.title,
        mode: identity.mode,
        school: snapshot?.userTeam?.name ?? null,
        coachName: snapshot?.coachName ?? null,
        playerName: snapshot?.player?.name ?? null,
        issues,
        publishedAt: Date.now(),
        redact: { secrets, username: usernameFromPath(settings.savesFolder ?? activeProfile?.saveFile ?? null) },
      });

      // The tripwire is a stop, not a warning. If anything that looks like a secret survived
      // the redactor, nothing is uploaded — the bundle is wrong and the fix is in the code.
      if (leaks.length > 0) {
        setErr(`Publishing stopped: ${leaks.join(", ")} would have been included. Nothing was uploaded.`);
        return;
      }
      if (bundle.weeks.length === 0) {
        setErr("There's nothing to publish yet — generate a week first.");
        return;
      }

      const res = await publishDynasty(forumUrl, bundle, state.token);
      setState(await savePublishState(dynastyId, {
        visibility: "public",
        id: res.id,
        publishedAt: Date.now(),
        weeksPublished: bundle.weeks.length,
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Publishing failed.");
    } finally {
      setBusy(false);
    }
  }, [busy, state, dynastyId, settings, activeProfile, identity, snapshot, forumUrl]);

  const unpublish = useCallback(async () => {
    if (busy || !state?.id) return;
    setBusy(true);
    setErr(null);
    try {
      await unpublishDynasty(forumUrl, state.id, state.token);
      setState(await savePublishState(dynastyId, { visibility: "private", id: null }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't take it down.");
    } finally {
      setBusy(false);
    }
  }, [busy, state, dynastyId, forumUrl]);

  if (!state) return null;
  const isPublic = state.visibility === "public" && !!state.id;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-sans text-[10px] uppercase tracking-widest",
            isPublic ? "border-dw-green/50 text-dw-green" : "border-dw-border text-ink3"
          )}
        >
          {isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {isPublic ? "Public" : "Private"}
        </span>
        {held && (
          <span className="font-sans text-[11px] text-ink3">
            {held.weeks} week{held.weeks === 1 ? "" : "s"} would publish ·{" "}
            <span className="text-ink2">{held.privateTabs}</span> private section
            {held.privateTabs === 1 ? "" : "s"} held back
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-dw-border bg-paper2 p-3">
          <p className="font-sans text-[10px] uppercase tracking-widest text-dw-green">Spectators see</p>
          <ul className="mt-1.5 space-y-0.5">
            {SECTIONS_PUBLIC.map((s) => (
              <li key={s} className="font-serif text-[13px] text-ink2">{s}</li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-dw-border bg-paper2 p-3">
          <p className="font-sans text-[10px] uppercase tracking-widest text-dw-red">Never leaves this machine</p>
          <ul className="mt-1.5 space-y-0.5">
            {SECTIONS_PRIVATE.map((s) => (
              <li key={s} className="font-serif text-[13px] text-ink2">{s}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="font-serif text-xs leading-relaxed text-ink3">
        Publishing puts the sections on the left on a public page anyone with the link can read.
        Your API keys, save paths and account name are stripped before anything is sent, and the
        upload is refused outright if any of them survive. Taking it down removes the page — but
        it cannot un-read what someone already saw.
      </p>

      {err && <p className="font-serif text-sm text-dw-red">{err}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void publish()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded border border-dw-crimson bg-dw-crimson px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isPublic ? "Update the public page" : "Publish to the forum"}
        </button>
        {isPublic && (
          <>
            <a
              href={`${forumUrl.replace(/\/+$/, "")}/d/${state.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-dw-border px-3 py-2 font-sans text-xs text-ink2 hover:text-ink"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View the page
            </a>
            <button
              type="button"
              onClick={() => void unpublish()}
              disabled={busy}
              className="rounded border border-dw-border px-3 py-2 font-sans text-xs uppercase tracking-wider text-ink3 hover:text-dw-red disabled:opacity-50"
            >
              Make private
            </button>
          </>
        )}
      </div>

      {isPublic && state.publishedAt && (
        <p className="font-sans text-[11px] text-ink3">
          Last published {new Date(state.publishedAt).toLocaleString()} · {state.weeksPublished} weeks live
        </p>
      )}
    </div>
  );
}
