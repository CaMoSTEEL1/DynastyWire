// The last thing that runs before anything leaves this machine.
//
// The app has told every user "Nothing leaves your machine" since the first release. The
// moment a dynasty can be published that stops being automatically true, so it has to be
// made true on purpose — here, in one place, with tests.
//
// What is actually sitting in the local stores, verified by reading them:
//
//   dynastywire.settings.json  Anthropic, OpenAI and ElevenLabs API keys; the saves folder
//                              and the last-ingested path for every dynasty. Those paths are
//                              absolute, so they carry the operating-system username:
//                              C:\Users\<name>\OneDrive\Documents\...
//
//   dynastywire.issues.json    Generated media — and, in the interactive tabs, things the
//                              USER typed. One real thread contains a phone number and a
//                              person's name that a tester wrote into a booster DM.
//
// Two defences, deliberately overlapping. EXACT removal is the strong one: the caller hands
// over the secrets it actually holds and every occurrence goes, wherever it appears and
// however it got there. PATTERN removal is the backstop for what the caller forgot to pass
// or never knew about — a key pasted into a press-conference answer, a path quoted in an
// error message that got cached.
//
// Nothing here is clever. It is meant to be obvious enough to audit.

export interface RedactOptions {
  /** Values known to be secret — the API keys and paths read from the local stores. */
  secrets?: (string | null | undefined)[];
  /** The OS username, stripped wherever it appears. Usually derived from a save path. */
  username?: string | null;
}

/** Long enough that removing it cannot be a coincidence. Shorter "secrets" are ignored
 * rather than risk blanking a common word that happens to match a setting. */
const MIN_SECRET_LENGTH = 8;

export const REDACTED = "[redacted]";

/** Provider key shapes. Deliberately greedy — a false positive costs a spectator nothing. */
const KEY_PATTERNS: RegExp[] = [
  // Anthropic: sk-ant-api03-…
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  // OpenAI and the many providers that copied the shape, including sk-proj-.
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  // ElevenLabs keys are bare hex with no prefix to key off, so match the length.
  /\b[a-f0-9]{48,}\b/gi,
  // Anything that announces itself. The separator is optional because the real-world shape
  // is "Authorization: Bearer <token>" — the colon sits before the word, not after it.
  /\b(?:bearer|api[_-]?key|token)\b\s*[:=]?\s*\S{12,}/gi,
];

/** Absolute paths, which carry the username and the machine's shape. */
const PATH_PATTERNS: RegExp[] = [
  // C:\Users\name\… and C:/Users/name/…
  /[A-Za-z]:[\\/](?:[^\s"'<>|]*[\\/])?[^\s"'<>|]*/g,
  // /Users/name/… and /home/name/…
  /\/(?:Users|home)\/[^\s"'<>|]+/g,
  // UNC shares.
  /\\\\[^\s"'<>|]+/g,
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The username out of an absolute path, so it can be stripped from prose that names it
 * without quoting a full path. Returns null when the path is not a user directory.
 */
export function usernameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const win = /[A-Za-z]:[\\/]Users[\\/]([^\\/]+)/.exec(path);
  if (win) return win[1];
  const nix = /\/(?:Users|home)\/([^/]+)/.exec(path);
  return nix ? nix[1] : null;
}

/** Scrub one string. */
export function redactText(input: string, opts: RedactOptions = {}): string {
  let out = input;

  // Exact secrets first: longest first, so a key that contains another string as a prefix
  // does not get half-removed and left recognisable.
  const secrets = (opts.secrets ?? [])
    .filter((s): s is string => typeof s === "string" && s.trim().length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const s of secrets) out = out.split(s).join(REDACTED);

  for (const re of KEY_PATTERNS) out = out.replace(re, REDACTED);
  for (const re of PATH_PATTERNS) out = out.replace(re, REDACTED);

  if (opts.username && opts.username.length >= 3) {
    out = out.replace(new RegExp(`\\b${escapeRe(opts.username)}\\b`, "gi"), REDACTED);
  }
  return out;
}

/**
 * Scrub a whole value — strings, arrays, objects, and OBJECT KEYS.
 *
 * Keys matter as much as values here: the issue cache stores a tab under
 * `figure-text::{"thread":[…]}`, so the conversation lives in the key itself. Walking values
 * alone would publish it verbatim.
 */
export function redactDeep<T>(value: T, opts: RedactOptions = {}): T {
  if (typeof value === "string") return redactText(value, opts) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, opts)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[redactText(k, opts)] = redactDeep(v, opts);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * A last look before publishing: does anything that reads like a secret still survive?
 *
 * This is a tripwire, not the defence — the defence is `redactDeep`. It exists so a bundle
 * can be refused rather than uploaded when a shape nobody anticipated slips through. It
 * reports WHAT it found by category and never echoes the value.
 */
export function findLeaks(value: unknown, opts: RedactOptions = {}): string[] {
  const found = new Set<string>();
  const secrets = (opts.secrets ?? []).filter(
    (s): s is string => typeof s === "string" && s.trim().length >= MIN_SECRET_LENGTH
  );

  const scanString = (s: string) => {
    for (const secret of secrets) if (s.includes(secret)) found.add("a known local secret");
    if (KEY_PATTERNS.some((re) => new RegExp(re.source, re.flags.replace("g", "")).test(s))) {
      found.add("something shaped like an API key");
    }
    if (PATH_PATTERNS.some((re) => new RegExp(re.source, re.flags.replace("g", "")).test(s))) {
      found.add("an absolute file path");
    }
    if (opts.username && opts.username.length >= 3) {
      if (new RegExp(`\\b${escapeRe(opts.username)}\\b`, "i").test(s)) found.add("the account username");
    }
  };

  const walk = (v: unknown) => {
    if (typeof v === "string") scanString(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
        scanString(k);
        walk(inner);
      }
    }
  };
  walk(value);
  return [...found];
}
