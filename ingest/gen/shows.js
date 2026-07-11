// Broadcast show transcripts. Ported from the old
// src/app/api/shows/generate/[showType]/route.ts (personas + per-show prompts).
// Standalone build: grounds off ctx.userContext (real week/season truth) instead
// of the old Supabase season_state / narrative_memory. Returns a ShowTranscript.
//
//   await generate('shows', { showType })  ->  ShowTranscript

const { callClaude } = require('./_shared');

const PERSONAS = {
  gameday: [
    { name: 'Marcus Cole', role: 'Host', affiliation: 'DynastyWire', personality: 'Enthusiastic and energetic, loves big moments' },
    { name: 'Diana Reeves', role: 'Analyst', affiliation: 'CFP Network', personality: 'Analytical and data-driven, always has the numbers' },
    { name: 'Troy Washington', role: 'Analyst', affiliation: 'DynastyWire', personality: 'Contrarian hot-take artist, provocative but entertaining' },
  ],
  rankings: [
    { name: 'Marcus Cole', role: 'Host', affiliation: 'DynastyWire', personality: 'Enthusiastic and energetic, drives the studio discussion' },
    { name: 'Diana Reeves', role: 'Analyst', affiliation: 'CFP Network', personality: 'Analytical and data-driven, defends or critiques rankings with evidence' },
    { name: 'Troy Washington', role: 'Analyst', affiliation: 'DynastyWire', personality: 'Contrarian hot-take artist, loves to argue a team is overrated or underrated' },
  ],
  portal: [
    { name: 'Jake Morrison', role: 'Reporter', affiliation: 'Portal Insider Network', personality: 'Connected insider with sources everywhere, speaks in scoops' },
    { name: 'Lisa Chen', role: 'Analyst', affiliation: 'CFP Network', personality: 'Measured and thoughtful, evaluates roster impact carefully' },
    { name: 'Marcus Cole', role: 'Host', affiliation: 'DynastyWire', personality: 'Enthusiastic and energetic, ties portal moves to the bigger picture' },
  ],
  draft: [
    { name: 'Pete Nakamura', role: 'Scout', affiliation: 'Draft Scout Network', personality: 'Former NFL scout, evaluates players with technical precision' },
    { name: 'Diana Reeves', role: 'Analyst', affiliation: 'CFP Network', personality: 'Analytical and data-driven, compares prospects to NFL archetypes' },
  ],
  hotseat: [
    { name: 'Troy Washington', role: 'Host', affiliation: 'DynastyWire', personality: 'Provocative and direct, not afraid to say a coach should be fired' },
    { name: 'Lisa Chen', role: 'Analyst', affiliation: 'CFP Network', personality: 'Measured and fair, considers context and program trajectory' },
  ],
};

function buildShowTitle(showType) {
  switch (showType) {
    case 'gameday': return { title: 'DynastyWire GameDay', subtitle: 'Pre-game preview panel' };
    case 'rankings': return { title: 'The Rankings Report', subtitle: 'Weekly top-25 show' };
    case 'portal': return { title: 'Portal Insider', subtitle: 'Transfer portal segment' };
    case 'draft': return { title: 'Draft Scout', subtitle: 'NFL draft prospect breakdown' };
    case 'hotseat': return { title: 'Hot Seat Weekly', subtitle: 'Coaching performance segment' };
    default: return { title: 'DynastyWire GameDay', subtitle: 'Pre-game preview panel' };
  }
}

function buildPrompt(showType, ctx, personas) {
  const personaBlock = personas
    .map((p) => `- ${p.name} (${p.role}, ${p.affiliation}): ${p.personality}`)
    .join('\n');

  const lines = [
    `You are generating a transcript for a college football broadcast show called "${buildShowTitle(showType).title}".`,
    'The show features these recurring personalities:',
    personaBlock,
    '',
    `School: ${ctx.school}`,
    `Head Coach: ${ctx.coachName}`,
    `Current Week: ${ctx.week}`,
    '',
    'Season & game context (source of truth — never invent scores, stats, or ranks beyond this):',
    ctx.userContext,
    '',
  ];

  switch (showType) {
    case 'gameday':
      lines.push(
        'Generate a lively pre-game/post-game panel discussion. The analysts should debate the team\'s performance,',
        'make observations about the season trajectory, and reference specific stats and results from the context.',
        'Include natural banter, disagreements, and stage directions like [turns to camera] or [laughs].',
        'The discussion should feel authentic to a real ESPN/Fox Sports studio show.'
      );
      break;
    case 'rankings':
      lines.push(
        'Generate a rankings discussion segment. The analysts should debate whether the team\'s ranking is justified,',
        'discuss playoff implications, compare to other teams, and argue about who should move up or down.',
        'Include references to the team\'s record, strength of schedule, and key wins/losses.',
        'Include stage directions and natural disagreements between the personalities.'
      );
      break;
    case 'portal':
      lines.push(
        'Generate a transfer portal segment. Jake Morrison should share insider scoops about portal activity',
        'related to the team. Discuss potential transfers in and out, roster needs, and how portal moves',
        'could impact the program. Reference the team\'s current record and needs based on the context.',
        'Include stage directions and natural conversation flow.'
      );
      break;
    case 'draft':
      lines.push(
        'Generate an NFL draft prospect evaluation segment. Pete Nakamura should provide scout-level analysis',
        'of the team\'s top NFL prospects. Discuss draft stock, combine projections, and how the season',
        'performance is affecting their draft position. Use fictional player names that fit the program.',
        'Include stage directions and technical football evaluation language.'
      );
      break;
    case 'hotseat':
      lines.push(
        'Generate a coaching hot seat discussion. Troy Washington should be provocative about the coach\'s job security',
        'while Lisa Chen provides measured counterpoints. Discuss the team\'s trajectory, fan sentiment,',
        'administration patience, and what the coach needs to do to save their job or cement their position.',
        'Reference the record, losses, and overall program direction. Include stage directions.'
      );
      break;
  }

  lines.push(
    '',
    'Respond with valid JSON only. No markdown fences. Use this exact schema:',
    '{"dialogue": [{"speaker": "Name", "role": "Role", "text": "what they say or the stage direction", "isStageDirection": false}]}',
    '',
    'Generate 12-20 dialogue lines. Mix regular dialogue with 2-4 stage directions.',
    "Stage directions use text like '[turns to camera]', '[shakes head]', '[pulls up graphic]'.",
    'For a stage direction, set speaker to the person performing it and isStageDirection to true.',
    'Reference real details from the context. Do not invent scores or stats not provided.'
  );

  return lines.join('\n');
}

async function generate(ctx, apiKey, extra) {
  const requested = extra && extra.showType;
  const showType = PERSONAS[requested] ? requested : 'gameday';
  const personas = PERSONAS[showType];
  const { title, subtitle } = buildShowTitle(showType);

  const prompt = buildPrompt(showType, ctx, personas);
  const parsed = await callClaude(ctx, apiKey, prompt, 2048);
  const dialogue = parsed && Array.isArray(parsed.dialogue)
    ? parsed.dialogue.map((l) => ({
        speaker: String(l.speaker || ''),
        role: String(l.role || ''),
        text: String(l.text || ''),
        isStageDirection: Boolean(l.isStageDirection),
      }))
    : [];

  return {
    showType,
    title,
    subtitle,
    personas,
    dialogue,
    week: ctx.week,
    error: dialogue.length === 0,
  };
}

module.exports = { generate };
