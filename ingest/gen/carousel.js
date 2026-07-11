// Coaching carousel. Ported from the old src/app/api/carousel/generate/route.ts +
// src/lib/carousel/generators.ts (generateStaffProfiles + generateCoachingRumors).
// Standalone build: no Supabase season_state / coachYear. We ground off ctx.userContext
// (real record + prestige). Rumor RESOLUTION is gone — rumors are rendered read-only.
// The shared parseJSON extracts a single JSON object, so we ask the model to wrap its
// arrays in {"staff": [...]} / {"rumors": [...]}.
//
//   await generate('carousel', {})  ->  { staff: StaffMember[], rumors: CoachingRumor[] }

const { callClaude } = require('./_shared');

function prestige(ctx) {
  const p = ctx.snapshot && ctx.snapshot.userTeam && ctx.snapshot.userTeam.prestige;
  return p != null ? `${p}/10` : 'unknown';
}

function recordLine(ctx) {
  const u = ctx.snapshot && ctx.snapshot.userTeam;
  if (u && u.wins != null && u.losses != null) return `${u.wins}-${u.losses}`;
  return 'unknown';
}

const STAFF_FALLBACK = [
  { id: 'oc-fallback', name: 'Mike Callahan', role: 'OC', hotSeatLevel: 'lukewarm', yearsOnStaff: 2, reputation: 'Veteran coordinator known for conservative play-calling under pressure.' },
  { id: 'dc-fallback', name: 'Ray Dawkins', role: 'DC', hotSeatLevel: 'secure', yearsOnStaff: 1, reputation: 'Former NFL linebackers coach who brings an aggressive, blitz-heavy scheme.' },
];

async function generateStaff(ctx, apiKey) {
  const prompt = [
    'Generate 2-3 coaching staff members for a college football program.',
    'Respond with valid JSON only, no markdown fences, wrapped as {"staff": [ ... ]}.',
    'Each staff object matches this schema exactly:',
    '{"id": "unique_string", "name": "Full Name", "role": "OC"|"DC"|"ST"|"Position Coach", "hotSeatLevel": "secure"|"lukewarm"|"hot", "yearsOnStaff": number, "reputation": "one sentence"}',
    '',
    '- At least one OC and one DC. Names realistic but fictional.',
    `- Hot seat levels vary with prestige (${prestige(ctx)}) and the season record (${recordLine(ctx)}).`,
    '- yearsOnStaff between 1 and 6.',
    '',
    `School: ${ctx.school}`,
    `Head Coach: ${ctx.coachName}`,
    `Prestige: ${prestige(ctx)}`,
    `Season record: ${recordLine(ctx)}`,
  ].join('\n');

  const parsed = await callClaude(ctx, apiKey, prompt, 1200);
  const staff = parsed && Array.isArray(parsed.staff) ? parsed.staff : null;
  if (
    staff &&
    staff.length >= 2 &&
    staff.every((s) => s && typeof s.name === 'string' && typeof s.role === 'string')
  ) {
    return staff;
  }
  return STAFF_FALLBACK;
}

async function generateRumors(ctx, apiKey, staff) {
  const u = ctx.snapshot && ctx.snapshot.userTeam;
  const isLosing = u && u.losses != null && u.wins != null && u.losses > u.wins;
  const rumorCount = isLosing ? '2-3' : '1-2';
  const staffDescriptions = staff
    .map((s) => `${s.name} (${s.role}, hot seat: ${s.hotSeatLevel}, ${s.yearsOnStaff}yr, reputation: ${s.reputation})`)
    .join('\n  ');

  const prompt = [
    `Generate ${rumorCount} coaching carousel rumors.`,
    'Respond with valid JSON only, no markdown fences, wrapped as {"rumors": [ ... ]}.',
    'Each rumor object matches this schema exactly:',
    '{"id": "unique_string", "staffMember": {"id","name","role","hotSeatLevel","yearsOnStaff","reputation"}, "type": "interview_request"|"poaching_attempt"|"forced_departure"|"loyalty_test", "suitor": "School Name", "narrative": "2-3 sentence insider report", "urgency": "low"|"medium"|"high"}',
    '',
    '- Reference ONLY the provided staff members.',
    '- Losing seasons skew toward forced_departure / interview_request; winning seasons toward poaching_attempt / loyalty_test.',
    '- High-prestige suitor schools create higher urgency. Narratives read like insider reports.',
    `- The suitor school must be different from ${ctx.school}.`,
    '',
    `School: ${ctx.school}`,
    `Head Coach: ${ctx.coachName}`,
    `Season record: ${recordLine(ctx)}`,
    `Prestige: ${prestige(ctx)}`,
    `Staff:\n  ${staffDescriptions}`,
  ].join('\n');

  const parsed = await callClaude(ctx, apiKey, prompt, 1500);
  const rumors = parsed && Array.isArray(parsed.rumors) ? parsed.rumors : null;
  if (
    rumors &&
    rumors.length >= 1 &&
    rumors.every((r) => r && r.staffMember && typeof r.staffMember.name === 'string' && typeof r.narrative === 'string')
  ) {
    return rumors;
  }
  return [
    {
      id: 'rumor-fallback-1',
      staffMember: staff[0],
      type: 'interview_request',
      suitor: 'Alabama',
      narrative: `Sources indicate ${staff[0].name} has drawn interest from another program's coaching search. An interview is expected this week.`,
      urgency: 'medium',
    },
  ];
}

async function generate(ctx, apiKey, _extra) {
  const staff = await generateStaff(ctx, apiKey);
  const rumors = await generateRumors(ctx, apiKey, staff);
  return { staff, rumors };
}

module.exports = { generate };
