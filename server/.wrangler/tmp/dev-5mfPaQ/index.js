var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var INDEX_KEY = "index.json";
var MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
var MAX_LISTED = 500;
var PUBLIC_KINDS = /* @__PURE__ */ new Set([
  "recap-lead",
  "national-wire",
  "national-desk",
  "social",
  "rankings",
  "shows",
  "trophy"
]);
var json = /* @__PURE__ */ __name((body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...cors(), ...extra }
}), "json");
var text = /* @__PURE__ */ __name((body, status) => new Response(body, { status, headers: cors() }), "text");
function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-dw-token"
  };
}
__name(cors, "cors");
function tokenMatches(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(tokenMatches, "tokenMatches");
async function sha256Hex(s) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
var clean = /* @__PURE__ */ __name((v, max = 120) => (
  // Strip control characters: they are never legitimate in a title and they are how you smuggle
  // line breaks and terminal escapes into somebody else's directory listing.
  typeof v === "string" ? [...v].filter((c) => c.codePointAt(0) >= 32 && c.codePointAt(0) !== 127).join("").trim().slice(0, max) : null
), "clean");
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
    publishedAt: Number(input.publishedAt) || Date.now()
  };
}
__name(sanitizeBundle, "sanitizeBundle");
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
    updatedAt
  };
}
__name(listingFrom, "listingFrom");
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
__name(readIndex, "readIndex");
async function writeIndex(env, items) {
  const trimmed = items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LISTED);
  await env.BUNDLES.put(INDEX_KEY, JSON.stringify(trimmed), {
    httpMetadata: { contentType: "application/json" }
  });
}
__name(writeIndex, "writeIndex");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (path === "/api/dynasties" && request.method === "GET") {
      const items = await readIndex(env);
      const q = (url.searchParams.get("q") || "").toLowerCase().trim();
      const filtered = q ? items.filter(
        (i) => [i.title, i.school, i.coachName, i.playerName, i.handle].filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
      ) : items;
      return json({ items: filtered.slice(0, 100) });
    }
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
      const id = (await sha256Hex(token)).slice(0, 16);
      const tokenHash = await sha256Hex(token);
      const existing = await env.BUNDLES.get(`meta/${id}.json`);
      if (existing) {
        const meta = JSON.parse(await existing.text());
        if (!tokenMatches(meta.tokenHash, tokenHash)) return text("That dynasty belongs to someone else.", 403);
      }
      const updatedAt = Date.now();
      await env.BUNDLES.put(`bundle/${id}.json`, JSON.stringify(bundle), {
        httpMetadata: { contentType: "application/json" }
      });
      await env.BUNDLES.put(`meta/${id}.json`, JSON.stringify({ tokenHash, updatedAt }), {
        httpMetadata: { contentType: "application/json" }
      });
      const items = (await readIndex(env)).filter((i) => i.id !== id);
      items.push(listingFrom(id, bundle, updatedAt));
      await writeIndex(env, items);
      return json({ id, url: `${url.origin}/d/${id}` });
    }
    const one = /^\/api\/dynasties\/([A-Za-z0-9_-]{4,64})$/.exec(path);
    if (one) {
      const id = one[1];
      if (request.method === "GET") {
        const obj = await env.BUNDLES.get(`bundle/${id}.json`);
        if (!obj) return text("Not found.", 404);
        return new Response(obj.body, {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=60", ...cors() }
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
  }
};

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-dkaERK/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-dkaERK/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
