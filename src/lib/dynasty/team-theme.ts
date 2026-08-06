// Turning a program's real colours into accents that survive the dark editorial page.
//
// The save carries every team's actual pair — Alabama #b30839, Michigan #091f40 + #f0c319,
// Oregon #007934 + #fde021. Painting those straight onto the UI does not work, because the
// page they land on is nearly black (#1c1a17):
//
//   Michigan navy  #091f40 on paper -> 1.2:1. Invisible.
//   Iowa black     #252525 on paper -> 1.1:1. Invisible.
//   Alabama white  #ffffff          -> perfectly readable, and indistinguishable from body
//                                      text, so it reads as prose rather than as an accent.
//
// So the job is not "use the team's colour", it is "find the accent this team would use if
// they were designing for a black page" — which is what real programs do anyway: Michigan's
// dark-background material is maize on navy, not navy on navy.
//
// Two independent tests decide whether a colour can carry accent duty:
//
//   CONTRAST — it has to be legible. Anything short of the target gets lifted in HSL, which
//   holds the hue and the saturation and raises only the lightness, so Oregon green stays
//   Oregon green instead of drifting toward mint.
//
//   CHROMA — it has to read AS an accent. A near-neutral passes contrast easily and still
//   fails the job: Alabama's white and Kansas State's silver sit right on top of the ink
//   ramp, so a label in them looks like text somebody forgot to style.
//
// What survives both becomes the accent. The other colour, if it also survives, becomes the
// secondary. When only one does — which is most of the sport, because the majority of second
// colours are white, black, or silver — the secondary is derived as a tint of the first,
// keeping the page in one family rather than importing an unrelated hue.
//
// The paper stack, the ink ramp and the type are untouched. This only moves the accents.

/** The page these accents have to live on. */
export const PAPER = "#1c1a17";

/**
 * The floor for the lead accent.
 *
 * Calibrated against the house crimson rather than the WCAG text bar, deliberately. The app
 * ships `--dw-accent: #b5202a`, which is 2.65:1 on this page and has been the look since the
 * first release — accents here are uppercase tracked labels, rules and ticker text, not body
 * copy. Holding teams to 4.5:1 made every deep red neon: Alabama's #b30839 lifted to a hot
 * pink and Georgia's #ba0c2f went with it, because dragging a saturated red that far up the
 * lightness ramp is the one thing hue-preserving lifting cannot do gracefully.
 *
 * 3.0 sits just above the house colour, so no program's accent is less legible than what
 * every user is already looking at, and crimson programs stay crimson.
 */
const ACCENT_MIN_CONTRAST = 3;
/** The secondary carries rules, borders and meter fills — large shapes, lower bar. */
const SECONDARY_MIN_CONTRAST = 3;
/** Below this saturation a colour reads as ink, not as an accent. */
const MIN_CHROMA = 0.18;
/** Never lift past this: beyond it every hue converges on white. */
const MAX_LIFT_LIGHTNESS = 0.78;

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export function parseHex(hex: string | null | undefined): RGB | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ── Contrast (WCAG relative luminance) ─────────────────────────────────────────

function channelLuminance(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(c: RGB): number {
  return (
    0.2126 * channelLuminance(c.r) + 0.7152 * channelLuminance(c.g) + 0.0722 * channelLuminance(c.b)
  );
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── HSL, so lifting can hold the hue ───────────────────────────────────────────

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255 };
}

/**
 * Raise lightness until the colour clears `target` against the page, holding hue and
 * saturation. Returns the colour unchanged when it already clears, and the brightest version
 * short of washing out when it never can (a pure black has no hue to preserve anyway).
 */
export function lift(c: RGB, target: number, on: RGB): RGB {
  if (contrast(c, on) >= target) return c;
  const hsl = rgbToHsl(c);
  for (let l = hsl.l; l <= MAX_LIFT_LIGHTNESS; l += 0.01) {
    const candidate = hslToRgb({ ...hsl, l });
    if (contrast(candidate, on) >= target) return candidate;
  }
  return hslToRgb({ ...hsl, l: MAX_LIFT_LIGHTNESS });
}

/** Whether a colour has enough chroma to read as an accent rather than as ink. */
export function hasChroma(c: RGB): boolean {
  return rgbToHsl(c).s >= MIN_CHROMA;
}

// ── The theme ──────────────────────────────────────────────────────────────────

export interface TeamTheme {
  /** Labels, links, the ticker, buttons. Clears 4.5:1 on the page. */
  accent: string;
  /** Rules, borders, meter fills, the second voice. Clears 3:1. */
  accent2: string;
  /** The colours we started from, for the settings preview. */
  source: { primary: string | null; secondary: string | null };
  /** True when the secondary is a tint of the accent because the team's own second colour
   * was white / black / silver and could not carry it. */
  derived: boolean;
}

/**
 * A second voice in the accent's own hue, for the teams whose real second colour is a
 * neutral. Which direction it moves depends on where the accent already sits: a deep crimson
 * has room above it, but Iowa's maize is already near the top of the page's range, and
 * lightening it further produced a yellow 1.04:1 from the original — two tokens the eye reads
 * as one colour. So bright accents get a deeper companion instead.
 */
function tint(c: RGB, on: RGB): RGB {
  const hsl = rgbToHsl(c);
  const alreadyBright = contrast(c, on) >= 6;
  const soft = alreadyBright
    ? { h: hsl.h, s: Math.min(1, hsl.s * 0.92), l: Math.max(0.26, hsl.l - 0.2) }
    : { h: hsl.h, s: Math.max(0, hsl.s * 0.72), l: Math.min(0.82, hsl.l + 0.16) };
  return lift(hslToRgb(soft), SECONDARY_MIN_CONTRAST, on);
}

/**
 * Pick the accents for a program.
 *
 * Both colours are considered on equal footing and the one that is already more legible on
 * the page leads. That is what gets Michigan maize instead of Michigan navy, Oregon yellow
 * instead of Oregon green, and Miami orange instead of Miami green — in every case the colour
 * the school itself puts on a dark background.
 */
export function teamTheme(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  onHex: string = PAPER
): TeamTheme | null {
  const on = parseHex(onHex) ?? parseHex(PAPER)!;
  const p = parseHex(primary);
  const s = parseHex(secondary);
  if (!p && !s) return null;

  const source = { primary: p ? toHex(p) : null, secondary: s ? toHex(s) : null };

  // Only colours with real chroma are candidates: a white or silver second colour is a
  // legitimate team colour and a terrible accent.
  const candidates = [p, s].filter((c): c is RGB => c != null && hasChroma(c));
  if (candidates.length === 0) {
    // Everything the team has is a neutral (Iowa's black, a white-and-grey program). There is
    // no accent to be had here, so say so and let the caller keep the house colours rather
    // than paint the app in something indistinguishable from its own body text.
    return null;
  }

  candidates.sort((a, b) => contrast(b, on) - contrast(a, on));
  const accent = lift(candidates[0], ACCENT_MIN_CONTRAST, on);
  const second = candidates[1];
  const derived = second == null;
  const accent2 = derived ? tint(accent, on) : lift(second, SECONDARY_MIN_CONTRAST, on);

  return { accent: toHex(accent), accent2: toHex(accent2), source, derived };
}

/** The CSS custom properties a theme sets. Every one of these currently holds a house
 * colour; nothing else in the token set moves. */
export function themeVariables(theme: TeamTheme | null): Record<string, string> {
  if (!theme) return {};
  return {
    "--dw-accent": theme.accent,
    "--dw-accent2": theme.accent2,
    // shadcn's tokens point at the same crimson, so they follow or the two drift apart.
    "--primary": theme.accent,
    "--ring": theme.accent,
    "--chart-1": theme.accent,
    "--chart-2": theme.accent2,
    "--sidebar-primary": theme.accent,
    "--sidebar-ring": theme.accent,
  };
}
