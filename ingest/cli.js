#!/usr/bin/env node
// Dynasty Wire ingestion CLI (also the Tauri sidecar entry point).
//   node cli.js snapshot <save>            -> prints DynastySnapshot JSON
//   node cli.js delta <beforeSave> <after> -> prints WeekDelta JSON
// Add --pretty for a human-readable summary instead of raw JSON.

const { buildSnapshot } = require('./snapshot');
const { buildDelta } = require('./diff');
const { buildMediaContext, generateRecap, generateCycle } = require('./generate');

async function main() {
  const [, , cmd, ...args] = process.argv;
  const pretty = args.includes('--pretty');
  const files = args.filter((a) => !a.startsWith('--'));
  // --team "Name" pins the user's team (confirmed setting, not auto-guessed).
  const teamArgIdx = args.indexOf('--team');
  const opts = teamArgIdx >= 0 ? { userTeamName: args[teamArgIdx + 1] } : {};

  if (cmd === 'snapshot') {
    const snap = await buildSnapshot(files[0], opts);
    if (pretty) return printSnapshot(snap);
    return console.log(JSON.stringify(snap));
  }

  if (cmd === 'delta') {
    // Parse sequentially — two 9.6MB saves in parallel in one process can OOM.
    const before = await buildSnapshot(files[0], opts);
    const after = await buildSnapshot(files[1], opts);
    const delta = buildDelta(before, after);
    if (pretty) return printDelta(delta);
    return console.log(JSON.stringify(delta));
  }

  if (cmd === 'recap' || cmd === 'media') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('No ANTHROPIC_API_KEY in env (BYO-key). Set it and retry.');
      process.exit(2);
    }
    const before = await buildSnapshot(files[0], opts);
    const after = await buildSnapshot(files[1], opts);
    const delta = buildDelta(before, after);
    const coachIdx = args.indexOf('--coach');
    const ctx = buildMediaContext(delta, after, {
      userTeamName: opts.userTeamName,
      coachName: coachIdx >= 0 ? args[coachIdx + 1] : undefined,
    });

    if (cmd === 'recap') {
      const article = await generateRecap(ctx, apiKey);
      if (!article) return fail('recap generation returned nothing parseable');
      return pretty ? printRecap(article) : console.log(JSON.stringify(article));
    }
    // full media cycle
    const cycle = await generateCycle(ctx, apiKey);
    return pretty ? printCycle(cycle) : console.log(JSON.stringify(cycle));
  }

  console.error('usage: cli.js snapshot <save> | delta <b> <a> | recap <b> <a> | media <b> <a> [--team N] [--coach N] [--pretty]');
  process.exit(1);
}

function fail(msg) {
  console.error(msg);
  process.exit(3);
}

function rule(title) {
  console.log('\n' + '='.repeat(66) + `\n${title}\n` + '='.repeat(66));
}

function printRecap(a) {
  console.log('\n' + '='.repeat(66));
  console.log(a.headline.toUpperCase());
  console.log('  ' + a.byline);
  console.log('='.repeat(66) + '\n');
  console.log(a.body + '\n');
  console.log('  “' + a.pullQuote.replace(/^["“]|["”]$/g, '') + '”\n');
}

function printCycle(c) {
  if (c.recap) printRecap(c.recap);
  if (c.beatTakes && c.beatTakes.takes) {
    rule('3 THINGS WE LEARNED');
    for (const t of c.beatTakes.takes) console.log(`\n${t.number}. ${t.title}\n   ${t.body}`);
  }
  if (c.social && c.social.posts) {
    rule('THE WIRE — SOCIAL REACTIONS');
    for (const p of c.social.posts) {
      console.log(`\n[${p.type}] ${p.displayName} ${p.handle}  ♥ ${p.likes} ↻ ${p.reposts}`);
      console.log('   ' + p.body);
    }
  }
  if (c.rankings) {
    rule('RANKINGS WATCH');
    console.log(`\n${c.rankings.headline}  (${c.rankings.movement})\n${c.rankings.body}`);
  }
  console.log('');
}

function printSnapshot(s) {
  console.log(`Week ${s.week} · ${s.tableCount} tables`);
  if (s.userTeam) {
    const u = s.userTeam;
    console.log(
      `Your team: ${u.name} (${u.wins}-${u.losses})` +
        (u.rankMedia ? ` · AP #${u.rankMedia}` : ' · unranked') +
        (u.prestige != null ? ` · prestige ${u.prestige}` : '')
    );
  } else {
    console.log('Your team: (not detected — no unsimmed played game in this snapshot)');
  }
  const played = s.games.filter((g) => g.played).length;
  console.log(`Teams: ${Object.keys(s.teams).length} · Games on schedule: ${s.games.length} · played: ${played}`);
}

const rk = (v) => (v && v <= 25 ? `#${v}` : 'NR');

function printDelta(d) {
  console.log(`Week ${d.weekPlayed}   (${d.gamesPlayed} games played)`);
  if (d.userResult) {
    const r = d.userResult;
    const you = d.userTeam;
    const won = r.winner === you;
    console.log(`\n>>> YOUR GAME: ${r.away} ${r.awayScore} @ ${r.home} ${r.homeScore}  — ${won ? 'W' : 'L'} for ${you}\n`);
  }
  console.log('Top results:');
  for (const r of d.results.slice(0, 12)) {
    const ra = r.rankAway ? `#${r.rankAway} ` : '';
    const rh = r.rankHome ? `#${r.rankHome} ` : '';
    const star = r.userInvolved ? ' *' : '';
    console.log(`  wk${r.week}: ${ra}${r.away} ${r.awayScore} @ ${rh}${r.home} ${r.homeScore}${star}`);
  }
  if (d.rankingMoves.length) {
    console.log('\nBiggest ranking moves:');
    for (const m of d.rankingMoves.slice(0, 6)) {
      const dir = m.delta > 0 ? '▲' : '▼';
      console.log(`  ${dir} ${m.team}: ${m.from || 'NR'} → ${m.to || 'NR'}`);
    }
  }
}

main().catch((e) => {
  console.error('ingest error:', e.message);
  process.exit(1);
});
