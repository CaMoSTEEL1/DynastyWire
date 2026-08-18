import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrast, parseHex } from "./team-theme";

/**
 * The light palette, read from the stylesheet rather than copied here.
 *
 * Copying the values into the test would let the two drift apart and the test would keep
 * passing while the app went unreadable — which is exactly the failure mode a contrast test
 * exists to catch.
 */
function lightTokens(): Record<string, string> {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const start = css.indexOf(':root[data-theme="light"]');
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

describe("the light page is actually readable", () => {
  const t = lightTokens();
  const paper = t["--paper"];
  const card = t["--paper2"];

  it("defines the surfaces it needs", () => {
    for (const k of ["--paper", "--paper2", "--ink", "--ink2", "--ink3", "--dw-border"]) {
      expect(t[k], `${k} missing from the light block`).toBeTruthy();
    }
  });

  it("clears 4.5:1 for every text token, on the page AND on a card", () => {
    // Both surfaces, because the first pass metered 4.42 on the page and 3.97 on cards —
    // fine to the eye, under the line where it counts.
    const text = ["--ink", "--ink2", "--ink3", "--dw-accent", "--dw-accent2", "--dw-green", "--dw-red", "--dw-yellow"];
    for (const k of text) {
      const c = parseHex(t[k])!;
      expect(contrast(c, parseHex(paper)!), `${k} on --paper`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, parseHex(card)!), `${k} on --paper2`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps white legible on the crimson buttons wear", () => {
    // The bug this pins: the primary button set a crimson background and let its text colour
    // inherit. On the dark page that inherited near-white and looked deliberate; on cream it
    // inherited near-black and put dark ink on crimson.
    expect(contrast(parseHex("#ffffff")!, parseHex(t["--dw-accent"])!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the page and its cards distinguishable without being harsh", () => {
    const d = contrast(parseHex(paper)!, parseHex(card)!);
    expect(d).toBeGreaterThan(1.02);
    expect(d).toBeLessThan(1.5);
  });

  it("is a warm stock, not a white panel", () => {
    // The identity is editorial. A pure #ffffff page would be a different product.
    const [r, , b] = [paper.slice(1, 3), paper.slice(3, 5), paper.slice(5, 7)].map((h) => parseInt(h, 16));
    expect(r).toBeGreaterThan(b);
    expect(r).toBeLessThan(255);
  });
});
