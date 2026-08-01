# Tester brief — fact-check baseline round

Reusable copy for the tester drop. The ask is one thing: **play normally, then paste the
report.** Everything else is context they don't need.

Keep the Discord post symptom-first and short. No mechanism, no root cause, no "verified"
notes — the same rule as the changelogs.

---

## Discord post

> **DynastyWire {VERSION} — tester build**
>
> The Wire now fact-checks itself. Every article, presser, and post gets checked against
> your save for the stuff it should never get wrong: players on the wrong team, invented
> names, bad scores, wrong records, fake poll numbers. Nothing gets rewritten — it just
> counts.
>
> **What I need:** play a few weeks like normal, then Settings → Fact-check baseline →
> **Copy report** → paste it here.
>
> That report is what tells me which parts of the Wire to fix first. Right now I'm guessing.
>
> **Heads up:** it'll flag some things that aren't actually wrong — the checker is new.
> That's useful too, paste it anyway.
>
> Needs your own Anthropic key. Windows will warn on the installer (unsigned) —
> More info → Run anyway. Your existing dynasties are untouched.

---

## What the report contains

Rates per surface and model, the flagged claims themselves, the app version, and the date
range. No dynasty prose, no save file, no key — it is a few lines of text a tester can read
before pasting.

The claims matter more than the rates. On the first real run, 10 of 12 flagged items were
the checker's own false positives, and the only way to tell was reading the claim against
what the save says. A report without examples cannot be audited.

## What to expect from round one

A wave of false positives from school names this checker has never seen — `Texas A&M`,
`Miami (FL)`, `Ole Miss` — and from CFB's shared nicknames. Wildcats, Tigers and Bulldogs
each belong to several programs; that exact collision already produced a confidently wrong
verdict about the developer's own team.

**Round-one numbers are raw material for fixing the checker, not a quality metric for the
app.** Do not publish them as a hallucination rate.

## Version discipline

The report stamps the app version, and bundle filenames carry it too — but only if
`src-tauri/tauri.conf.json` → `version` is bumped before the build. Ship two different
builds under one version and the reports become impossible to attribute.
