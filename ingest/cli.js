#!/usr/bin/env node
// Dynasty Wire ingestion CLI (also the Tauri sidecar entry point).
//   node cli.js snapshot <save>            -> prints DynastySnapshot JSON
//   node cli.js delta <beforeSave> <after> -> prints WeekDelta JSON
// Add --pretty for a human-readable summary instead of raw JSON.

const { openSave, pickTable, readRecords, buildSnapshot, buildRecruits, buildRoster, buildPortal } = require('./snapshot');
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

  if (cmd === 'recruits') {
    const recruits = await buildRecruits(files[0]);
    return console.log(JSON.stringify({ recruits }));
  }

  if (cmd === 'portal') {
    const portal = await buildPortal(files[0]);
    return console.log(JSON.stringify(portal));
  }

  if (cmd === 'roster') {
    // One parse: resolve the team, then read its roster off the same open file.
    // --teamIndex N reads ANY team's roster (e.g. this week's opponent) directly.
    const f = await openSave(files[0]);
    const tiIdx = args.indexOf('--teamIndex');
    let teamIndex = tiIdx >= 0 ? Number(args[tiIdx + 1]) : null;
    if (teamIndex == null || Number.isNaN(teamIndex)) {
      const snap = await buildSnapshot(f, opts);
      teamIndex = snap.userTeam ? snap.userTeam.teamIndex : null;
    }
    const roster = await buildRoster(f, { teamIndex });
    return console.log(JSON.stringify({ roster }));
  }

  // Consequence Sync: write the media-universe meters BACK into the save so they have real
  // in-game impact. Payload (base64 JSON via --payload):
  //   { teamIndex, confidence: [{name, value}], programPointsDelta, jobSecurityPct,
  //     nil: [{name, value}], overall: [{name, value}] }
  // `overall` sets a player's OverallRating (suspensions: a temporary drop buries him on the
  // depth chart so the game benches him; the before value is returned so it can be restored).
  // Safety: refuses when the file is locked (game running), takes a timestamped backup
  // (keeps 5) before writing, and verifies every write by re-opening the saved file.
  if (cmd === 'impact') {
    const fs = require('fs');
    const path = require('path');
    const savePath = files[0];
    const pIdx = args.indexOf('--payload');
    if (pIdx < 0) return fail('impact: missing --payload');
    const payload = JSON.parse(Buffer.from(args[pIdx + 1], 'base64').toString('utf8'));

    // 1. Locked? (CFB27 holds the file open while running)
    try {
      const fd = fs.openSync(savePath, 'r+');
      fs.closeSync(fd);
    } catch (e) {
      return console.log(JSON.stringify({ ok: false, error: 'locked', detail: 'Save file is locked — close College Football 27 first.' }));
    }

    // 2. Backup (keep the 5 newest per save name)
    const dir = path.join(path.dirname(savePath), 'dynastywire-backups');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(savePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dir, `${base}.${stamp}.bak`);
    fs.copyFileSync(savePath, backupPath);
    const old = fs.readdirSync(dir).filter((n) => n.startsWith(base + '.')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 5))) {
      try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* ignore */ }
    }

    // 3. Apply
    const f = await openSave(savePath);
    const applied = { confidence: [], programPoints: null, jobSecurity: null };
    const teamIndex = payload.teamIndex;

    if (Array.isArray(payload.confidence) && payload.confidence.length) {
      const playerT = await readRecords(pickTable(f, 'Player'));
      const wanted = new Map(payload.confidence.map((c) => [String(c.name).toLowerCase(), c.value]));
      for (const p of playerT.records) {
        if (p.isEmpty) continue;
        try {
          if (p['TeamIndex'] !== teamIndex) continue;
          const nm = `${p['FirstName'] || ''} ${p['LastName'] || ''}`.trim().toLowerCase();
          if (!wanted.has(nm)) continue;
          const v = Math.max(5, Math.min(99, Math.round(wanted.get(nm))));
          p['ConfidenceRating'] = v;
          applied.confidence.push({ name: nm, value: v });
        } catch (e) { /* skip unreadable rows */ }
      }
    }

    if (typeof payload.programPointsDelta === 'number' && payload.programPointsDelta !== 0) {
      const teamT = await readRecords(pickTable(f, 'Team'));
      for (const t of teamT.records) {
        if (t.isEmpty) continue;
        try {
          if (t['TeamIndex'] !== teamIndex) continue;
          const cur = t['RemainingProgramPoints'] || 0;
          const next = Math.max(0, cur + Math.round(payload.programPointsDelta));
          t['RemainingProgramPoints'] = next;
          applied.programPoints = { before: cur, after: next };
          break;
        } catch (e) { /* ignore */ }
      }
    }

    if (typeof payload.jobSecurityPct === 'number') {
      const coachT = await readRecords(pickTable(f, 'Coach'));
      for (const r of coachT.records) {
        if (r.isEmpty) continue;
        try {
          if (r['IsUserControlled'] === true || r['IsUserControlled'] === 1) {
            const v = Math.max(1, Math.min(100, Math.round(payload.jobSecurityPct)));
            const before = r['CurrentJobSecurityPercentage'];
            r['CurrentJobSecurityPercentage'] = v;
            applied.jobSecurity = { before, after: v };
            break;
          }
        } catch (e) { /* ignore */ }
      }
    }

    // NIL allotment — set each named player's CurrentNILCompensation. Verified writable +
    // persistent on a real save. Available any time in the season.
    applied.nil = [];
    if (Array.isArray(payload.nil) && payload.nil.length) {
      const playerT = await readRecords(pickTable(f, 'Player'));
      const wanted = new Map(payload.nil.map((c) => [String(c.name).toLowerCase(), c.value]));
      for (const p of playerT.records) {
        if (p.isEmpty) continue;
        try {
          if (p['TeamIndex'] !== teamIndex) continue;
          const nm = `${p['FirstName'] || ''} ${p['LastName'] || ''}`.trim().toLowerCase();
          if (!wanted.has(nm)) continue;
          const v = Math.max(0, Math.min(100000, Math.round(wanted.get(nm))));
          const before = p['CurrentNILCompensation'];
          p['CurrentNILCompensation'] = v;
          applied.nil.push({ name: nm, before, after: v });
        } catch (e) { /* skip unreadable rows */ }
      }
    }

    // Player overall — suspensions drop it (the game auto-buries a 40 OVR on the depth
    // chart) and restore it when served. Writes OverallRating, falling back to
    // PlayerOverallRating where that's the field the save actually carries.
    applied.overall = [];
    if (Array.isArray(payload.overall) && payload.overall.length) {
      const playerT = await readRecords(pickTable(f, 'Player'));
      const wanted = new Map(payload.overall.map((c) => [String(c.name).toLowerCase(), c.value]));
      for (const p of playerT.records) {
        if (p.isEmpty) continue;
        try {
          if (p['TeamIndex'] !== teamIndex) continue;
          const nm = `${p['FirstName'] || ''} ${p['LastName'] || ''}`.trim().toLowerCase();
          if (!wanted.has(nm)) continue;
          const v = Math.max(25, Math.min(99, Math.round(wanted.get(nm))));
          const field = p['OverallRating'] != null ? 'OverallRating'
            : p['PlayerOverallRating'] != null ? 'PlayerOverallRating' : 'OverallRating';
          const before = p[field];
          p[field] = v;
          applied.overall.push({ name: nm, field, before, after: v });
        } catch (e) { /* skip unreadable rows */ }
      }
    }

    await f.save(savePath);

    // 4. Verify by re-opening
    const f2 = await openSave(savePath);
    let verified = true;
    if (applied.confidence.length) {
      const pT2 = await readRecords(pickTable(f2, 'Player'));
      const check = new Map(applied.confidence.map((c) => [c.name, c.value]));
      let seen = 0;
      for (const p of pT2.records) {
        if (p.isEmpty) continue;
        try {
          if (p['TeamIndex'] !== teamIndex) continue;
          const nm = `${p['FirstName'] || ''} ${p['LastName'] || ''}`.trim().toLowerCase();
          if (!check.has(nm)) continue;
          seen++;
          if (p['ConfidenceRating'] !== check.get(nm)) verified = false;
        } catch (e) { /* ignore */ }
      }
      if (seen !== applied.confidence.length) verified = false;
    }
    if (applied.nil.length) {
      const pT2 = await readRecords(pickTable(f2, 'Player'));
      const check = new Map(applied.nil.map((c) => [c.name, c.after]));
      let seen = 0;
      for (const p of pT2.records) {
        if (p.isEmpty) continue;
        try {
          if (p['TeamIndex'] !== teamIndex) continue;
          const nm = `${p['FirstName'] || ''} ${p['LastName'] || ''}`.trim().toLowerCase();
          if (!check.has(nm)) continue;
          seen++;
          if (p['CurrentNILCompensation'] !== check.get(nm)) verified = false;
        } catch (e) { /* ignore */ }
      }
      if (seen !== applied.nil.length) verified = false;
    }
    if (applied.overall.length) {
      const pT2 = await readRecords(pickTable(f2, 'Player'));
      const check = new Map(applied.overall.map((c) => [c.name, c]));
      let seen = 0;
      for (const p of pT2.records) {
        if (p.isEmpty) continue;
        try {
          if (p['TeamIndex'] !== teamIndex) continue;
          const nm = `${p['FirstName'] || ''} ${p['LastName'] || ''}`.trim().toLowerCase();
          if (!check.has(nm)) continue;
          seen++;
          const c = check.get(nm);
          if (p[c.field] !== c.after) verified = false;
        } catch (e) { /* ignore */ }
      }
      if (seen !== applied.overall.length) verified = false;
    }
    return console.log(JSON.stringify({ ok: true, verified, applied, backup: backupPath }));
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

  // Generic per-kind generator: `generate <kind> <before> <after> [--extra <json>]`.
  // Dispatches to ingest/gen/<kind>.js (exports generate(ctx, apiKey, extra)).
  if (cmd === 'generate') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return fail('No ANTHROPIC_API_KEY in env (BYO-key).');
    const kind = files[0];
    const before = await buildSnapshot(files[1], opts);
    const after = await buildSnapshot(files[2], opts);
    const delta = buildDelta(before, after);
    const coachIdx = args.indexOf('--coach');
    const ctx = buildMediaContext(delta, after, {
      userTeamName: opts.userTeamName,
      coachName: coachIdx >= 0 ? args[coachIdx + 1] : undefined,
    });
    ctx.snapshot = after; // per-kind modules may need richer snapshot data
    ctx.delta = delta;
    const extraIdx = args.indexOf('--extra');
    const extra = extraIdx >= 0 ? JSON.parse(args[extraIdx + 1]) : {};
    let mod;
    try {
      mod = require(`./gen/${kind}.js`);
    } catch {
      return fail(`unknown generator kind: ${kind}`);
    }
    const result = await mod.generate(ctx, apiKey, extra);
    if (!result) return fail(`${kind} generation returned nothing`);
    return console.log(JSON.stringify(result));
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

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error('ingest error:', e.message);
    process.exit(1);
  });
