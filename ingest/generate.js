// Turn a real diff delta into a full DynastyWire media cycle: recap, "3 things we
// learned", social reactions, and a rankings take. Bridges parsed save data into the
// PromptContext shape the Next.js generators use, then calls Claude (BYO-key).
// Prompts/voice mirror src/lib/ai/generators.ts.

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = [
  'You are the DynastyWire content engine, an AI college-football media simulator.',
  'Voice: bold, authentic, electric — late-night ESPN meets College GameDay. Sharp,',
  'unapologetic, real. Never sterile or generic.',
  '',
  'RULES:',
  '1. Respond with valid JSON matching the exact schema requested. No markdown fences.',
  '2. Never invent scores, stats, ranks, or records. The context is the sole source of truth.',
  '3. If a team is stated UNRANKED, never assign it a poll number.',
  '4. Write in authentic CFB media voice with real terminology and culture.',
  '5. Match tone to the result — a blowout reads differently than a nail-biter.',
].join('\n');

const MODEL = () => process.env.DW_MODEL || 'claude-sonnet-5';

function fmtRank(r) {
  return r && r <= 25 ? `#${r} ` : '';
}

// Render the real delta + season state into the shared userContext text block.
function buildMediaContext(delta, after, opts = {}) {
  const u = after.userTeam;
  const school = u ? u.name : opts.userTeamName || 'the team';
  const coachName = opts.coachName || 'the head coach';
  const g = delta.userResult;

  const parts = [];
  parts.push('=== DYNASTY CONTEXT ===');
  parts.push(`Program: ${school}`);
  if (u) {
    parts.push(`Record: ${u.wins}-${u.losses}` + (u.confWins != null ? ` (${u.confWins}-${u.confLosses} conf)` : ''));
    // Explicit, guarded ranking line so the model can't fabricate a poll number.
    parts.push(
      u.rankMedia
        ? `AP ranking: #${u.rankMedia}`
        : 'AP ranking: UNRANKED (not in the AP Top 25 — do NOT assign this team any poll number)'
    );
    if (u.prestige != null) parts.push(`Program prestige: ${u.prestige}/10`);
  }
  parts.push(`Head coach: ${coachName}`);
  parts.push(`Week: ${delta.weekPlayed}`);
  parts.push('');

  if (g) {
    const userIsHome = g.home === school;
    const usScore = userIsHome ? g.homeScore : g.awayScore;
    const oppScore = userIsHome ? g.awayScore : g.homeScore;
    const oppName = userIsHome ? g.away : g.home;
    const oppRank = userIsHome ? g.rankAway : g.rankHome;
    const won = usScore > oppScore;
    const usQ = userIsHome ? g.homeQuarters : g.awayQuarters;
    const oppQ = userIsHome ? g.awayQuarters : g.homeQuarters;

    parts.push("=== THIS WEEK'S GAME (source of truth) ===");
    parts.push(
      `${school} ${won ? 'defeated' : 'lost to'} ${fmtRank(oppRank)}${oppName}, ` +
        `${usScore}-${oppScore} (${userIsHome ? 'home' : 'away'}).`
    );
    parts.push(`Result: ${won ? 'WIN' : 'LOSS'} · Margin: ${Math.abs(usScore - oppScore)}`);
    if (usQ && oppQ && usQ.every((x) => x != null)) {
      parts.push(`${school} by quarter: ${usQ.join('-')}   |   ${oppName} by quarter: ${oppQ.join('-')}`);
    }
    parts.push('');
  } else {
    parts.push("(No game for the user this week — bye or not yet played.)");
    parts.push('');
  }

  const ranked = delta.results
    .filter((r) => (r.rankHome && r.rankHome <= 25) || (r.rankAway && r.rankAway <= 25))
    .filter((r) => !r.userInvolved)
    .slice(0, 6);
  if (ranked.length) {
    parts.push('=== AROUND THE NATION (this week, ranked teams) ===');
    for (const r of ranked) {
      parts.push(`  ${fmtRank(r.rankAway)}${r.away} ${r.awayScore} @ ${fmtRank(r.rankHome)}${r.home} ${r.homeScore}`);
    }
    parts.push('');
  }
  if (delta.rankingMoves && delta.rankingMoves.length) {
    parts.push('=== POLL MOVEMENT ===');
    for (const m of delta.rankingMoves.slice(0, 6)) {
      parts.push(`  ${m.team}: ${m.from && m.from <= 25 ? '#' + m.from : 'NR'} -> ${m.to && m.to <= 25 ? '#' + m.to : 'NR'}`);
    }
  }

  return { systemPrompt: SYSTEM_PROMPT, userContext: parts.join('\n'), school, coachName, week: delta.weekPlayed };
}

function parseJSON(raw) {
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    return s >= 0 && e >= 0 ? JSON.parse(raw.slice(s, e + 1)) : null;
  } catch {
    return null;
  }
}

async function callClaude(ctx, apiKey, prompt, maxTokens = 1200) {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL(),
    max_tokens: maxTokens,
    system: ctx.systemPrompt,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content.find((b) => b.type === 'text');
  return parseJSON(text ? text.text : '');
}

async function generateRecap(ctx, apiKey) {
  return callClaude(
    ctx,
    apiKey,
    [
      'Write a 150-word beat reporter game recap as JSON with this exact schema:',
      '{"headline": "string", "byline": "string", "body": "string", "pullQuote": "string"}',
      '',
      `The byline is a fictional beat reporter covering ${ctx.school}.`,
      "The body reads like a professional newspaper recap of THIS WEEK'S GAME.",
      `The pullQuote is a compelling quote attributed to Coach ${ctx.coachName} or a player. Provide the quote text only, without surrounding quotation marks.`,
      '',
      'Context:',
      ctx.userContext,
    ].join('\n')
  );
}

async function generateBeatTakes(ctx, apiKey) {
  return callClaude(
    ctx,
    apiKey,
    [
      "Write '3 Things We Learned' as JSON with this exact schema:",
      '{"headline": "string", "takes": [{"number": 1, "title": "string", "body": "string"}, {"number": 2, "title": "string", "body": "string"}, {"number": 3, "title": "string", "body": "string"}]}',
      '',
      `Write about ${ctx.school} Week ${ctx.week} from a beat reporter's perspective.`,
      'Each take is 40-60 words, insightful and analytical.',
      '',
      'Context:',
      ctx.userContext,
    ].join('\n')
  );
}

async function generateSocialPosts(ctx, apiKey) {
  return callClaude(
    ctx,
    apiKey,
    [
      'Generate 8 social media posts reacting to this game as JSON with this exact schema:',
      '{"posts": [{"handle": "string", "displayName": "string", "type": "fan"|"rival"|"analyst"|"insider"|"reddit", "body": "string", "likes": number, "reposts": number}]}',
      '',
      `Posts react to ${ctx.school}'s Week ${ctx.week} result. Use the ACTUAL score and opponent.`,
      'Include a mix: 3 fan, 1 rival, 2 analyst, 1 insider, 1 reddit. type MUST be one of those 5 values.',
      'Voice by type:',
      '- fan: emotional, ALL CAPS energy, overreactions; euphoric after wins, self-deprecating after losses.',
      '- rival: snarky schadenfreude, scoreboard energy, mock the actual opponent.',
      '- analyst: film/stats/scheme, measured but a clear take (ESPN/247 voice).',
      '- insider: "sources tell me" energy, locker-room mood, recruiting implications.',
      '- reddit: self-deprecating humor, absurd comparisons, viral energy.',
      'Handles feel real (@CFBTakesMachine, @' + ctx.school.replace(/\s/g, '') + 'Insider). Fan posts 500-2000 likes, analysts 100-500. Plain text only.',
      '',
      'Context:',
      ctx.userContext,
    ].join('\n'),
    2000
  );
}

async function generateRankingsTake(ctx, apiKey) {
  return callClaude(
    ctx,
    apiKey,
    [
      "Write a 100-word CFP analyst take about this team's ranking picture as JSON with this exact schema:",
      '{"headline": "string", "body": "string", "movement": "string"}',
      '',
      `Analyze ${ctx.school}'s playoff/ranking picture after Week ${ctx.week}. If UNRANKED, frame it as trying to break in — never invent a number.`,
      "movement is a short phrase like 'On the bubble', 'Knocking on the door', 'Holds at #8', 'Drops out'.",
      '',
      'Context:',
      ctx.userContext,
    ].join('\n')
  );
}

async function generateCycle(ctx, apiKey) {
  // Sequential to stay well under rate limits and keep memory low in the sidecar.
  const recap = await generateRecap(ctx, apiKey);
  const beatTakes = await generateBeatTakes(ctx, apiKey);
  const social = await generateSocialPosts(ctx, apiKey);
  const rankings = await generateRankingsTake(ctx, apiKey);
  return { recap, beatTakes, social, rankings };
}

module.exports = {
  buildMediaContext,
  buildRecapContext: buildMediaContext, // back-compat alias
  generateRecap,
  generateBeatTakes,
  generateSocialPosts,
  generateRankingsTake,
  generateCycle,
  // shared helpers for per-kind generator modules under ingest/gen/
  callClaude,
  parseJSON,
  SYSTEM_PROMPT,
  MODEL,
};
