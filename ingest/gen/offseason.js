// Offseason phase narratives. Ported from the old
// src/app/api/offseason/generate/[phase]/route.ts + src/lib/offseason/generators.ts.
// Standalone build: no Supabase persistence, no season-transition, no recruit table.
// Each phase is generated on demand from ctx.userContext (real season truth). Where the
// old flow leaned on a full season_state / recruit board that no longer exists, we
// degrade to fictional-but-grounded narrative.
//
//   await generate('offseason', { phase })  ->  phase content object

const { callClaude } = require('./_shared');

const VALID_PHASES = [
  'bowl_recap',
  'awards',
  'portal_window',
  'coaching_carousel',
  'signing_day',
  'spring_preview',
];

function prestigeLine(ctx) {
  const p = ctx.snapshot && ctx.snapshot.userTeam && ctx.snapshot.userTeam.prestige;
  return p != null ? `${p}/10` : 'unknown';
}

function frame(ctx) {
  return [
    `You are a college football beat writer and insider covering ${ctx.school}.`,
    `The head coach is ${ctx.coachName}. Program prestige: ${prestigeLine(ctx)}.`,
    'Write in a vivid, editorial style befitting a premium sports publication.',
    'Ground everything in the season context below — never invent scores, ranks, or records beyond it.',
    '',
    'Season context (source of truth):',
    ctx.userContext,
    '',
  ];
}

function buildPrompt(phase, ctx) {
  const head = frame(ctx);
  switch (phase) {
    case 'bowl_recap':
      return head.concat([
        'Write a season-ending bowl recap article as JSON with this exact schema:',
        '{"headline": "string", "body": "string (300-400 words)", "socialReactions": [{"handle": "string", "body": "string", "type": "fan"|"analyst"|"rival"}]}',
        '',
        'Include 5-6 social reactions with a mix of fan, analyst, and rival perspectives.',
        'Reflect on the entire season arc, not just the final game. Reference the coach by name.',
      ]).join('\n');
    case 'awards':
      return head.concat([
        'Generate end-of-season awards as JSON with this exact schema:',
        '{"awards": [{"name": "string", "winner": "string", "description": "string"}], "allConference": [{"name": "string", "position": "string"}], "narrative": "string (100-150 words)"}',
        '',
        'Include 4-6 awards (Team MVP, Offensive/Defensive Player of the Year, Freshman of the Year, Most Improved, Unsung Hero).',
        '6-8 all-conference selections with fictional player names and positions.',
        `Use fictional player names that fit the ${ctx.school} program.`,
      ]).join('\n');
    case 'portal_window':
      return head.concat([
        'Generate transfer portal activity as JSON with this exact schema:',
        '{"entries": [{"name": "string", "position": "string", "direction": "in"|"out", "reason": "string", "impact": "string"}], "narrative": "string (100-150 words)"}',
        '',
        'Include 6-10 portal entries with a realistic mix of incoming and outgoing players.',
        'Base the volume on the season results — a rough season means more departures.',
        'Impact describes what the move means for the roster (e.g., "Leaves a gap at left tackle").',
      ]).join('\n');
    case 'coaching_carousel':
      return head.concat([
        'Generate coaching carousel rumors as JSON with this exact schema:',
        '{"rumors": [{"staffName": "string", "role": "string", "school": "string", "likelihood": "confirmed"|"likely"|"rumored"|"unlikely", "narrative": "string"}], "headline": "string"}',
        '',
        'Include 3-5 coordinator / position-coach rumors. At least one poaching attempt, at least one potential hire.',
        `Make it realistic for a ${prestigeLine(ctx)} prestige program. The headline reflects the biggest rumor.`,
      ]).join('\n');
    case 'signing_day':
      return head.concat([
        'Generate signing day results as JSON with this exact schema:',
        '{"decisions": [{"name": "string", "position": "string", "stars": number, "decision": "committed"|"flipped"|"decommitted"|"surprise", "narrative": "string"}], "classGrade": "string (e.g. A-, B+, C)", "summary": "string (100-150 words)"}',
        '',
        'Generate 4-6 fictional recruits making their signing day decisions. Mix decisions — not everyone commits.',
        'Include at least one surprise. classGrade should reflect prestige and season results.',
      ]).join('\n');
    case 'spring_preview':
      return head.concat([
        'Generate a spring preview article as JSON with this exact schema:',
        '{"headline": "string", "body": "string (250-350 words)", "keyStorylines": ["string","string","string","string","string"], "preseasonRanking": number|null}',
        '',
        'Forward-looking preview of the upcoming season. Exactly 5 key storylines (15-25 words each).',
        'preseasonRanking is a realistic 1-25 number, or null if unranked. Discuss roster changes and expectations.',
      ]).join('\n');
    default:
      return head.join('\n');
  }
}

// Minimal grounded fallbacks so a screen degrades instead of breaking.
function fallback(phase, ctx) {
  switch (phase) {
    case 'bowl_recap':
      return {
        headline: `${ctx.school} Closes the Book on the Season`,
        body: `The ${ctx.school} program has wrapped another campaign under head coach ${ctx.coachName}. Highs and lows alike now give way to an offseason of evaluation and the work of building toward next year.`,
        socialReactions: [
          { handle: '@DynastyWireStaff', body: `Another season in the books for ${ctx.school}. Time to reload.`, type: 'analyst' },
          { handle: '@FaithfulFan', body: 'Proud of our guys no matter what. On to next year.', type: 'fan' },
        ],
      };
    case 'awards':
      return {
        awards: [{ name: 'Team MVP', winner: 'Season Standout', description: `Carried ${ctx.school} through a demanding campaign.` }],
        allConference: [{ name: 'Marcus Williams', position: 'QB' }, { name: 'DeShawn Carter', position: 'WR' }],
        narrative: `The ${ctx.school} honorees represent the heart of a program still shaping its identity under Coach ${ctx.coachName}.`,
      };
    case 'portal_window':
      return {
        entries: [
          { name: 'Jordan Mitchell', position: 'LB', direction: 'out', reason: 'Seeking a starting role elsewhere', impact: 'Thins the linebacker depth chart' },
          { name: 'Caleb Torres', position: 'WR', direction: 'in', reason: `Drawn to ${ctx.coachName}'s system`, impact: 'Adds a vertical threat' },
        ],
        narrative: `${ctx.school} works the portal to shore up weaknesses while managing departures.`,
      };
    case 'coaching_carousel':
      return {
        rumors: [
          { staffName: 'Mike Reynolds', role: 'Offensive Coordinator', school: ctx.school, likelihood: 'rumored', narrative: 'Reynolds has reportedly drawn outside interest after his work this season.' },
          { staffName: 'Anthony Brooks', role: 'Defensive Line Coach', school: ctx.school, likelihood: 'likely', narrative: `Brooks is expected to stay on Coach ${ctx.coachName}'s staff.` },
        ],
        headline: `Staff Shakeup? ${ctx.school} Carousel Heating Up`,
      };
    case 'signing_day':
      return {
        decisions: [
          { name: 'Jaylen Brooks', position: 'QB', stars: 4, decision: 'committed', narrative: `Brooks chose ${ctx.school}, citing Coach ${ctx.coachName}'s development track record.` },
          { name: 'Marcus Thompson', position: 'DE', stars: 3, decision: 'flipped', narrative: `Thompson flipped away from ${ctx.school} in a late surprise.` },
        ],
        classGrade: 'B',
        summary: `${ctx.school}'s signing day mixed elation and disappointment as Coach ${ctx.coachName} closed the class.`,
      };
    case 'spring_preview':
      return {
        headline: `${ctx.school} Spring Preview: What to Watch`,
        body: `As spring practice opens, ${ctx.school} enters a pivotal stretch under Coach ${ctx.coachName}. Roster turnover creates both challenges and opportunities, and position battles will define the spring.`,
        keyStorylines: [
          'Quarterback competition headlines spring practice',
          'Transfer additions must integrate into the defensive scheme',
          'Offensive line depth remains a concern after graduation',
          'Young receivers could emerge with expanded roles',
          'Special teams overhaul targets last season\'s coverage struggles',
        ],
        preseasonRanking: null,
      };
    default:
      return {};
  }
}

async function generate(ctx, apiKey, extra) {
  const phase = extra && VALID_PHASES.includes(extra.phase) ? extra.phase : 'bowl_recap';
  const parsed = await callClaude(ctx, apiKey, buildPrompt(phase, ctx), 1800);
  return parsed && typeof parsed === 'object' ? parsed : fallback(phase, ctx);
}

module.exports = { generate };
