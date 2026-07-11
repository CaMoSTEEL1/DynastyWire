// Shared helpers for per-kind generator modules. Each module in this directory
// exports `generate(ctx, apiKey, extra)` and returns a JSON-serializable object.
// The CLI dispatcher (cli.js `generate <kind>`) builds `ctx` via buildMediaContext
// and dynamically requires ./<kind>.js — so adding a feature = adding one file here,
// with no edits to shared files (conflict-free for parallel work).
const g = require('../generate');
module.exports = {
  buildMediaContext: g.buildMediaContext,
  callClaude: g.callClaude, // (ctx, apiKey, promptString, maxTokens?) -> parsed JSON
  parseJSON: g.parseJSON,
  SYSTEM_PROMPT: g.SYSTEM_PROMPT,
};
