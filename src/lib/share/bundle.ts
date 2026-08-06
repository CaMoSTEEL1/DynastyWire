// A dynasty as a spectator sees it: the published paper, and nothing else.
//
// This is the contract for sharing, whether the bundle travels as a file today or through a
// hosted directory later. Getting it right matters more than anything built on top of it,
// because publishing is not reversible — you cannot un-share what someone has already read.
//
// THE RULE IS DEFAULT-DENY. A tab kind is public only by appearing in PUBLIC_KINDS below.
// Anything new — a tab added next month, a kind nobody remembered — is private until someone
// deliberately adds it here. The opposite default (deny-list) would leak every future tab by
// omission, and the omission would be silent.
//
// The other trap is the shape of the cache. Tabs are keyed `kind::<json of the request>`, so
// the key itself can carry a whole conversation:
//
//   figure-text::{"coachMessage":"…","thread":[{"from":"coach","text":"…"}]}
//
// Matching a key against an allowlist as a WHOLE STRING would therefore never match, and
// filtering on the value alone would publish the conversation in the key. Both are handled
// by splitting on "::" and judging the kind.

import { redactDeep, findLeaks, usernameFromPath, type RedactOptions } from "./redact";
import type { Issue, TabState } from "../dynasty/issue-cache";

/** Bumped whenever the shape changes, so a reader can refuse a bundle it cannot render. */
export const BUNDLE_VERSION = 1;

/**
 * The published paper. Front page, the wire, the national desk, social, rankings, the shows,
 * the trophy case — the media universe as written.
 *
 * Everything absent is absent on purpose. The press conference holds answers the user typed;
 * `figure-text` and `rtg-texts` are private messages; `nil`, `nil-reaction` and `brand-deals`
 * are money; `scouting` and `recruiting` are the gameplan and the board; `storylines` and
 * `rtg-situation` are the hot-seat internals. None of that is journalism — it is the user
 * playing, and a spectator has no business in it.
 */
export const PUBLIC_KINDS: ReadonlySet<string> = new Set([
  "recap-lead",
  "national-wire",
  "national-desk",
  "social",
  "rankings",
  "shows",
  "trophy",
]);

/** The kind of a stored tab key, which may carry a JSON payload after "::". */
export function kindOf(tabKey: string): string {
  return (tabKey ?? "").split("::")[0];
}

export function isPublicTab(tabKey: string): boolean {
  return PUBLIC_KINDS.has(kindOf(tabKey));
}

export type Visibility = "private" | "public";

export interface BundleWeek {
  year: number;
  week: number;
  /** Public tabs only, keyed by kind. The "::" payload is dropped: a spectator reads the
   * result, and the request that produced it is the owner's business. */
  tabs: Record<string, unknown>;
}

export interface DynastyBundle {
  bundleVersion: number;
  /** Display identity, chosen by the owner — never the OS account. */
  handle: string;
  title: string;
  mode: "dynasty" | "rtg";
  school: string | null;
  coachName: string | null;
  playerName: string | null;
  /** Newest first. */
  weeks: BundleWeek[];
  publishedAt: number;
}

export interface BuildInput {
  handle: string;
  title: string;
  mode: "dynasty" | "rtg";
  school?: string | null;
  coachName?: string | null;
  playerName?: string | null;
  issues: Issue[];
  /** Now, passed in rather than read, so a bundle is reproducible in a test. */
  publishedAt: number;
  /** Everything the local stores know to be secret. */
  redact?: RedactOptions;
}

/** Only a finished tab is worth publishing — a spectator should never meet "writing…". */
const isReady = (t: TabState | undefined): boolean => !!t && t.status === "ready" && t.data != null;

/**
 * Build the bundle. Order of operations is the whole safety argument:
 *   1. drop every tab whose KIND is not on the allowlist
 *   2. drop the "::" payload from the keys that survive
 *   3. redact what is left, keys included
 *   4. refuse to return anything if the tripwire still finds a secret
 */
export function buildBundle(input: BuildInput): { bundle: DynastyBundle; leaks: string[] } {
  const opts: RedactOptions = {
    ...input.redact,
    username:
      input.redact?.username ??
      usernameFromPath(input.redact?.secrets?.find((s) => typeof s === "string" && /[\\/]/.test(s))),
  };

  const weeks: BundleWeek[] = [];
  for (const issue of input.issues) {
    // A pregame edition is a preview of a week that has since been played; the archive shows
    // the week as it finished, and so does a spectator.
    if (issue.key.endsWith("::pre")) continue;
    const tabs: Record<string, unknown> = {};
    for (const [tabKey, state] of Object.entries(issue.tabs ?? {})) {
      if (!isPublicTab(tabKey) || !isReady(state)) continue;
      tabs[kindOf(tabKey)] = state.data;
    }
    if (Object.keys(tabs).length === 0) continue;
    weeks.push({ year: issue.year, week: issue.week, tabs });
  }
  weeks.sort((a, b) => b.year - a.year || b.week - a.week);

  const raw: DynastyBundle = {
    bundleVersion: BUNDLE_VERSION,
    handle: input.handle,
    title: input.title,
    mode: input.mode,
    school: input.school ?? null,
    coachName: input.coachName ?? null,
    playerName: input.playerName ?? null,
    weeks,
    publishedAt: input.publishedAt,
  };

  const bundle = redactDeep(raw, opts);
  return { bundle, leaks: findLeaks(bundle, opts) };
}

/** Parse and sanity-check a bundle someone else made. Never trusts its contents. */
export function parseBundle(json: string): { bundle: DynastyBundle | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { bundle: null, error: "That file isn't a DynastyWire bundle." };
  }
  const b = parsed as Partial<DynastyBundle>;
  if (typeof b?.bundleVersion !== "number") {
    return { bundle: null, error: "That file isn't a DynastyWire bundle." };
  }
  if (b.bundleVersion > BUNDLE_VERSION) {
    return { bundle: null, error: "This dynasty was shared by a newer version of DynastyWire. Update to read it." };
  }
  if (!Array.isArray(b.weeks)) return { bundle: null, error: "This bundle has no weeks in it." };

  // A bundle is untrusted input: re-apply the allowlist on the way IN as well as on the way
  // out, so a hand-edited file cannot get a private tab rendered by a spectator's app.
  const weeks: BundleWeek[] = b.weeks
    .filter((w): w is BundleWeek => !!w && typeof w === "object")
    .map((w) => ({
      year: Number(w.year) || 0,
      week: Number(w.week) || 0,
      tabs: Object.fromEntries(
        Object.entries(w.tabs ?? {}).filter(([kind]) => PUBLIC_KINDS.has(kind))
      ),
    }));

  return {
    bundle: {
      bundleVersion: b.bundleVersion,
      handle: String(b.handle ?? "someone"),
      title: String(b.title ?? "A dynasty"),
      mode: b.mode === "rtg" ? "rtg" : "dynasty",
      school: b.school ?? null,
      coachName: b.coachName ?? null,
      playerName: b.playerName ?? null,
      weeks,
      publishedAt: Number(b.publishedAt) || 0,
    },
    error: null,
  };
}
