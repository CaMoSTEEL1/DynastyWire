// Social feed generator. Returns 10 social posts reacting to THIS WEEK'S game.
// Schema: { posts: [{ handle, displayName, type, body, likes, reposts }] }
// Voice/prompt ported faithfully from HEAD:src/lib/ai/generators.ts (generateSocialPosts).
//
// ctx = { systemPrompt, userContext, school, coachName, week, snapshot, delta }
// extra = arbitrary options from the UI (currently unused).

const { callClaude } = require('./_shared');

const VALID_TYPES = new Set(['fan', 'rival', 'analyst', 'insider', 'reddit']);

async function generate(ctx, apiKey, _extra) {
  const school = ctx.school || 'the team';
  const handleBase = school.replace(/\s/g, '');

  const prompt = [
    'Generate 10 social media posts reacting to this game as JSON with this exact schema:',
    '{"posts": [{"handle": "string", "displayName": "string", "type": "fan"|"rival"|"analyst"|"insider"|"reddit", "body": "string", "likes": number, "reposts": number}]}',
    '',
    `Posts should react to ${school}'s Week ${ctx.week} result.`,
    'IMPORTANT: The type field MUST be one of exactly these 5 values: fan, rival, analyst, insider, reddit.',
    "Include a diverse mix: at least 3 fan posts, 1 rival fan (use type 'rival'), 2 analysts, 1 insider, and 2 reddit posts (funny/viral energy should go into the 'reddit' type).",
    '',
    'Key style notes for each type:',
    '- fan: Emotional, ALL CAPS energy, overreactions, heart-on-sleeve. Self-deprecating after losses, euphoric after wins.',
    "- rival: Snarky, schadenfreude, 'scoreboard' energy, mocking. Reference the actual opponent.",
    '- analyst: Film references, stats, scheme observations. Measured but with a clear take. Think ESPN or 247Sports voice.',
    "- insider: 'Sources tell me...' energy. Locker room mood, coaching staff reactions, recruiting implications.",
    '- reddit: Self-deprecating humor, absurd comparisons, copypasta energy, therapy jokes, funny/viral takes.',
    '',
    'IMPORTANT:',
    '- Use the ACTUAL score, opponent name, and game events from the context below.',
    `- Make handles feel real: @CFBTakesMachine, @BigGameBaker, @${handleBase}Insider, etc.`,
    '- Vary engagement realistically: high-energy fan posts get 500-2000 likes, analyst posts get 100-500.',
    "- The 'reposts' field is required (not retweets) — use a realistic number.",
    '- NO HTML entities. Use plain text quotes and punctuation.',
    '',
    'Context:',
    ctx.userContext,
  ].join('\n');

  const parsed = await callClaude(ctx, apiKey, prompt, 2000);

  // Normalize: coerce invalid types and fill missing reposts rather than failing the batch.
  if (parsed && Array.isArray(parsed.posts) && parsed.posts.length >= 1) {
    const normalized = parsed.posts
      .filter((p) => p && typeof p.handle === 'string' && typeof p.body === 'string')
      .map((p) => ({
        handle: String(p.handle),
        displayName: typeof p.displayName === 'string' ? p.displayName : String(p.handle),
        type: VALID_TYPES.has(p.type) ? p.type : 'fan',
        body: String(p.body),
        likes: typeof p.likes === 'number' ? p.likes : 0,
        reposts:
          typeof p.reposts === 'number'
            ? p.reposts
            : typeof p.retweets === 'number'
              ? p.retweets
              : 0,
      }));
    if (normalized.length >= 1) return { posts: normalized };
  }

  return { posts: [], error: true };
}

module.exports = { generate };
