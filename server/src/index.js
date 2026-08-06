// The forum: a Cloudflare Worker in front of an R2 bucket.
//
// Deliberately small. It stores bundles, lists them, serves them, and deletes them. It does
// not generate anything, it does not hold API keys, and it has no accounts — a published
// dynasty is owned by whoever holds the token that first created it, which lives on that
// user's machine and is never displayed.
//
// R2 rather than a database because the payload is a whole bundle read in one piece (~300 KB
// for a multi-season dynasty), and because R2 has no egress fee — the cost of one popular
// dynasty being read a thousand times is what would otherwise make this expensive.
//
// The listing index is kept as one small object rather than a per-request bucket scan, so the
// directory is a single GET no matter how many dynasties exist.

const INDEX_KEY = "index.json";
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024; // a season is ~350 KB; 5 MB is a generous ceiling
const MAX_LISTED = 500;

// The published paper, and nothing else. This MUST stay in step with PUBLIC_KINDS in
// src/lib/share/bundle.ts — the client applies it before upload and again on read, and the
// server applies it in the middle so a hand-rolled client cannot post a private section into
// somebody else's spectator view.
const PUBLIC_KINDS = new Set([
  "recap-lead",
  "national-wire",
  "national-desk",
  "social",
  "rankings",
  "shows",
  "trophy",
]);

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(), ...extra },
  });

const text = (body, status) => new Response(body, { status, headers: cors() });

// The desktop app is not a browser origin, but the spectator pages are, and a user may run
// their own copy of the app from anywhere. Reads are public; writes are gated by the token,
// not by origin, so a permissive CORS policy costs nothing here.
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-dw-token",
  };
}

/** Constant-time compare, so a token cannot be recovered a byte at a time. */
function tokenMatches(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (v, max = 120) =>
  // Strip control characters: they are never legitimate in a title and they are how you smuggle
  // line breaks and terminal escapes into somebody else's directory listing.
  typeof v === "string"
    ? [...v].filter((c) => c.codePointAt(0) >= 32 && c.codePointAt(0) !== 127).join("").trim().slice(0, max)
    : null;

/**
 * Re-apply the allowlist server-side and strip everything we do not serve.
 *
 * The client already does this, but the client is not a trust boundary: anyone can PUT
 * whatever JSON they like. This is what guarantees a spectator can only ever be served the
 * published paper, whoever wrote the uploader.
 */
function sanitizeBundle(input) {
  if (!input || typeof input !== "object") return null;
  if (typeof input.bundleVersion !== "number") return null;
  if (!Array.isArray(input.weeks)) return null;

  const weeks = [];
  for (const w of input.weeks.slice(0, 400)) {
    if (!w || typeof w !== "object") continue;
    const tabs = {};
    for (const [kind, data] of Object.entries(w.tabs ?? {})) {
      if (PUBLIC_KINDS.has(kind)) tabs[kind] = data;
    }
    if (Object.keys(tabs).length === 0) continue;
    weeks.push({ year: Number(w.year) || 0, week: Number(w.week) || 0, tabs });
  }
  if (weeks.length === 0) return null;

  return {
    bundleVersion: input.bundleVersion,
    handle: clean(input.handle, 40) || "anonymous",
    title: clean(input.title, 120) || "A dynasty",
    mode: input.mode === "rtg" ? "rtg" : "dynasty",
    school: clean(input.school, 80),
    coachName: clean(input.coachName, 80),
    playerName: clean(input.playerName, 80),
    weeks,
    publishedAt: Number(input.publishedAt) || Date.now(),
  };
}

function listingFrom(id, bundle, updatedAt) {
  const latest = bundle.weeks[0] ?? null;
  return {
    id,
    handle: bundle.handle,
    title: bundle.title,
    mode: bundle.mode,
    school: bundle.school,
    coachName: bundle.coachName,
    playerName: bundle.playerName,
    record: null,
    latestYear: latest ? latest.year : null,
    latestWeek: latest ? latest.week : null,
    weeks: bundle.weeks.length,
    updatedAt,
  };
}

async function readIndex(env) {
  const obj = await env.BUNDLES.get(INDEX_KEY);
  if (!obj) return [];
  try {
    const parsed = JSON.parse(await obj.text());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(env, items) {
  const trimmed = items
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_LISTED);
  await env.BUNDLES.put(INDEX_KEY, JSON.stringify(trimmed), {
    httpMetadata: { contentType: "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    // ── the directory ─────────────────────────────────────────────────────────
    if (path === "/api/dynasties" && request.method === "GET") {
      const items = await readIndex(env);
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      const filtered = q
        ? items.filter((i) =>
            [i.title, i.school, i.coachName, i.playerName, i.handle]
              .filter(Boolean)
              .some((f) => String(f).toLowerCase().includes(q))
          )
        : items;
      return json({ items: filtered.slice(0, 100) });
    }

    // ── publish / update ──────────────────────────────────────────────────────
    if (path === "/api/dynasties" && request.method === "PUT") {
      const token = request.headers.get("x-dw-token") || "";
      if (token.length < 32) return text("A publish token is required.", 401);

      const raw = await request.text();
      if (raw.length > MAX_BUNDLE_BYTES) return text("That dynasty is too large to publish.", 413);

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return text("That isn't a bundle.", 400);
      }
      const bundle = sanitizeBundle(parsed);
      if (!bundle) return text("That bundle has nothing publishable in it.", 400);

      // The id is derived from the token, so the same machine republishing the same dynasty
      // lands on the same page — an update, not a duplicate — without needing an account.
      const id = (await sha256Hex(token)).slice(0, 16);
      const tokenHash = await sha256Hex(token);

      const existing = await env.BUNDLES.get(`meta/${id}.json`);
      if (existing) {
        const meta = JSON.parse(await existing.text());
        if (!tokenMatches(meta.tokenHash, tokenHash)) return text("That dynasty belongs to someone else.", 403);
      }

      const updatedAt = Date.now();
      await env.BUNDLES.put(`bundle/${id}.json`, JSON.stringify(bundle), {
        httpMetadata: { contentType: "application/json" },
      });
      await env.BUNDLES.put(`meta/${id}.json`, JSON.stringify({ tokenHash, updatedAt }), {
        httpMetadata: { contentType: "application/json" },
      });

      const items = (await readIndex(env)).filter((i) => i.id !== id);
      items.push(listingFrom(id, bundle, updatedAt));
      await writeIndex(env, items);

      // Just the id. Spectating happens inside DynastyWire, so there is no page here to link
      // to — returning a URL that 404s would only invite somebody to share it.
      return json({ id });
    }

    // ── read one, and take one down ───────────────────────────────────────────
    const one = /^\/api\/dynasties\/([A-Za-z0-9_-]{4,64})$/.exec(path);
    if (one) {
      const id = one[1];
      if (request.method === "GET") {
        const obj = await env.BUNDLES.get(`bundle/${id}.json`);
        if (!obj) return text("Not found.", 404);
        return new Response(obj.body, {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=60", ...cors() },
        });
      }
      if (request.method === "DELETE") {
        const token = request.headers.get("x-dw-token") || "";
        const metaObj = await env.BUNDLES.get(`meta/${id}.json`);
        if (!metaObj) return text("Not found.", 404);
        const meta = JSON.parse(await metaObj.text());
        if (!tokenMatches(meta.tokenHash, await sha256Hex(token))) {
          return text("That dynasty belongs to someone else.", 403);
        }
        await env.BUNDLES.delete(`bundle/${id}.json`);
        await env.BUNDLES.delete(`meta/${id}.json`);
        await writeIndex(env, (await readIndex(env)).filter((i) => i.id !== id));
        return json({ ok: true });
      }
    }

    if (path === "/" || path === "/health") return json({ ok: true, service: "dynastywire-forum" });
    return text("Not found.", 404);
  },
};
