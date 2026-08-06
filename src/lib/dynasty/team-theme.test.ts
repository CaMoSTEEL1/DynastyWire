// The accent picker, tested against real programs and their real save colours.
//
// Two failure modes matter more than anything else here, and both are invisible in a unit
// test that only checks "did it return a colour":
//
//   ILLEGIBLE — Michigan navy or Iowa black straight onto a near-black page.
//   NOT AN ACCENT — Alabama white or Kansas State silver, which pass contrast easily and
//   then read as body text somebody forgot to style.
//
// So every case below asserts the RESULT against the page, not just that something came back.

import { describe, expect, it } from "vitest";
import {
  PAPER,
  contrast,
  hasChroma,
  hslToRgb,
  lift,
  parseHex,
  rgbToHsl,
  teamTheme,
  themeVariables,
  toHex,
} from "./team-theme";

const on = parseHex(PAPER)!;
const ratio = (hex: string) => contrast(parseHex(hex)!, on);
const hue = (hex: string) => rgbToHsl(parseHex(hex)!).h * 360;

// Straight out of a real week-18 save.
const REAL = {
  alabama: ["#b30839", "#ffffff"],
  michigan: ["#091f40", "#f0c319"],
  oregon: ["#007934", "#fde021"],
  kansasState: ["#330457", "#acb4b1"],
  iowa: ["#252525", "#ffcd00"],
  miami: ["#154734", "#e04726"],
  texas: ["#af5c37", "#ffffff"],
  lsu: ["#592d82", "#ffc52f"],
} as const;

describe("colour plumbing", () => {
  it("round-trips hex", () => {
    expect(toHex(parseHex("#b30839")!)).toBe("#b30839");
    expect(parseHex("b30839")).toEqual({ r: 179, g: 8, b: 57 });
  });

  it("refuses anything that is not a six-digit hex", () => {
    for (const bad of [null, undefined, "", "#fff", "red", "#gggggg"]) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it("round-trips through HSL", () => {
    for (const hex of ["#b30839", "#f0c319", "#007934", "#1c1a17"]) {
      expect(toHex(hslToRgb(rgbToHsl(parseHex(hex)!)))).toBe(hex);
    }
  });

  it("agrees with known contrast ratios", () => {
    expect(contrast(parseHex("#ffffff")!, parseHex("#000000")!)).toBeCloseTo(21, 0);
    expect(contrast(on, on)).toBeCloseTo(1, 5);
  });
});

describe("lift", () => {
  it("leaves a colour alone when it already clears the bar", () => {
    expect(toHex(lift(parseHex("#f0c319")!, 3, on))).toBe("#f0c319");
  });

  it("raises a colour that does not, and keeps its hue", () => {
    const navy = "#091f40";
    expect(ratio(navy)).toBeLessThan(3);
    const lifted = toHex(lift(parseHex(navy)!, 3, on));
    expect(ratio(lifted)).toBeGreaterThanOrEqual(3);
    // Still blue. This is the whole point of lifting in HSL rather than blending toward white.
    expect(Math.abs(hue(lifted) - hue(navy))).toBeLessThan(8);
  });

  it("gives up gracefully on a colour with no hue to preserve", () => {
    // Pure black can never reach a high bar without becoming grey; it must not loop forever.
    const out = toHex(lift(parseHex("#000000")!, 21, on));
    expect(ratio(out)).toBeGreaterThan(1);
  });
});

describe("chroma", () => {
  it("rejects the neutrals teams actually use as second colours", () => {
    for (const neutral of ["#ffffff", "#000000", "#acb4b1", "#b2b4b2", "#252525"]) {
      expect(hasChroma(parseHex(neutral)!)).toBe(false);
    }
  });

  it("accepts real accents", () => {
    for (const c of ["#f0c319", "#b30839", "#007934", "#e04726", "#c6b783"]) {
      expect(hasChroma(parseHex(c)!)).toBe(true);
    }
  });
});

describe("teamTheme picks the colour the school itself puts on black", () => {
  it("gives Michigan maize, not navy", () => {
    const t = teamTheme(...REAL.michigan)!;
    expect(t.accent).toBe("#f0c319");
    expect(t.derived).toBe(false);
    // Navy survives as the second voice, lifted until it can be seen.
    expect(ratio(t.accent2)).toBeGreaterThanOrEqual(3);
    expect(hue(t.accent2)).toBeGreaterThan(180);
  });

  it("gives Oregon yellow over green, and keeps the green", () => {
    const t = teamTheme(...REAL.oregon)!;
    expect(t.accent).toBe("#fde021");
    expect(hue(t.accent2)).toBeGreaterThan(90);
    expect(hue(t.accent2)).toBeLessThan(180);
  });

  it("gives Miami orange over green", () => {
    expect(teamTheme(...REAL.miami)!.accent).toBe("#e04726");
  });

  it("gives LSU gold, with purple behind it", () => {
    const t = teamTheme(...REAL.lsu)!;
    expect(t.accent).toBe("#ffc52f");
    expect(hue(t.accent2)).toBeGreaterThan(240);
  });
});

describe("teamTheme keeps crimson programs crimson", () => {
  it("does not turn Alabama pink", () => {
    const t = teamTheme(...REAL.alabama)!;
    expect(ratio(t.accent)).toBeGreaterThanOrEqual(3);
    // The bug this guards: a 4.5:1 floor lifted #b30839 to #f62b65, a hot pink.
    const h = hue(t.accent);
    expect(h > 330 || h < 15).toBe(true);
    expect(rgbToHsl(parseHex(t.accent)!).l).toBeLessThan(0.55);
  });

  it("leaves Texas burnt orange exactly as the school has it", () => {
    expect(teamTheme(...REAL.texas)!.accent).toBe("#af5c37");
  });
});

describe("teamTheme never accents with a neutral", () => {
  it("ignores Alabama's white and derives the second colour instead", () => {
    const t = teamTheme(...REAL.alabama)!;
    expect(t.accent).not.toBe("#ffffff");
    expect(t.derived).toBe(true);
    expect(hasChroma(parseHex(t.accent2)!)).toBe(true);
  });

  it("ignores Kansas State's silver and stays purple", () => {
    const t = teamTheme(...REAL.kansasState)!;
    expect(t.accent).not.toBe("#acb4b1");
    expect(hue(t.accent)).toBeGreaterThan(250);
    expect(hue(t.accent)).toBeLessThan(300);
  });

  it("takes Iowa's gold rather than its black", () => {
    expect(teamTheme(...REAL.iowa)!.accent).toBe("#ffcd00");
  });
});

describe("every accent it hands back is usable", () => {
  it("clears the page on both accents, for every real program", () => {
    for (const [name, [p, s]] of Object.entries(REAL)) {
      const t = teamTheme(p, s);
      expect(t, name).not.toBeNull();
      expect(ratio(t!.accent), `${name} accent`).toBeGreaterThanOrEqual(3);
      expect(ratio(t!.accent2), `${name} accent2`).toBeGreaterThanOrEqual(3);
      expect(hasChroma(parseHex(t!.accent)!), `${name} accent chroma`).toBe(true);
    }
  });

  it("gives the two accents enough separation to read as two voices", () => {
    for (const [name, [p, s]] of Object.entries(REAL)) {
      const t = teamTheme(p, s)!;
      expect(t.accent2, name).not.toBe(t.accent);
      // Not just a different string — different enough to tell apart on the page.
      expect(contrast(parseHex(t.accent)!, parseHex(t.accent2)!), name).toBeGreaterThan(1.2);
    }
  });
});

describe("when there is nothing to work with", () => {
  it("returns null rather than painting the app in its own body text", () => {
    // A program whose only colours are black and white. Keeping the house accents is the
    // honest outcome; a grey "accent" would just look like a styling bug.
    expect(teamTheme("#000000", "#ffffff")).toBeNull();
    expect(teamTheme("#252525", "#acb4b1")).toBeNull();
  });

  it("returns null when the save carries no colours at all", () => {
    expect(teamTheme(null, null)).toBeNull();
    expect(teamTheme(undefined, undefined)).toBeNull();
  });

  it("works from a primary alone", () => {
    const t = teamTheme("#b30839", null)!;
    expect(t.derived).toBe(true);
    expect(ratio(t.accent)).toBeGreaterThanOrEqual(3);
  });
});

describe("themeVariables", () => {
  it("moves the accent tokens and nothing else", () => {
    const vars = themeVariables(teamTheme(...REAL.michigan));
    expect(vars["--dw-accent"]).toBe("#f0c319");
    // The paper stack and the ink ramp are the product's identity — they must not appear.
    for (const untouchable of ["--paper", "--paper2", "--ink", "--ink2", "--background", "--foreground"]) {
      expect(vars).not.toHaveProperty(untouchable);
    }
  });

  it("is empty when there is no theme, so the house colours stand", () => {
    expect(themeVariables(null)).toEqual({});
  });
});
