#!/usr/bin/env node
// Cut a signed portable release, or roll one back.
//
//   node scripts/release.mjs prepare        build + sign + package dist/release/<version>/
//   node scripts/release.mjs rollback <ver> re-publish an OLDER release as "latest"
//
// Dynasty Wire ships as ONE portable .exe — no installer. The app replaces itself (see
// `update_apply` in src-tauri/src/lib.rs), so the artifact clients download IS the exe, and
// it must be signed with the same minisign key the binary verifies against.
//
// The rollback path is the reason this script exists. An auto-updater pushes a bad build to
// every tester at once, and the only cheap undo is re-pointing `latest.json` at a version
// that already works — uploaded artifacts are immutable, so nothing has to be rebuilt.
// Keep every release folder; they are the rollback targets.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONF = join(ROOT, "src-tauri", "tauri.conf.json");
const RELEASES = join(ROOT, "dist", "release");
const KEY = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? "C:/Users/edg03/.tauri/dynastywire.key";
const REPO = "CaMoSTEEL1/DynastyWire";
const EXE_NAME = "DynastyWire.exe";

const conf = JSON.parse(readFileSync(CONF, "utf8"));
const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true, ...opts });

function prepare() {
  const version = conf.version;
  const out = join(RELEASES, version);
  if (existsSync(out)) {
    die(`dist/release/${version} already exists. Bump "version" in src-tauri/tauri.conf.json first — two different builds under one version makes tester reports impossible to attribute.`);
  }
  if (!existsSync(KEY)) {
    die(`No signing key at ${KEY}. Without it the release is unsigned and EVERY client rejects the update.`);
  }

  console.log(`\n  Building ${version} …`);
  run("npx", ["tauri", "build"]);

  const built = join(ROOT, "src-tauri", "target", "release", "dynastywire.exe");
  if (!existsSync(built)) die(`No exe at ${built}.`);

  mkdirSync(out, { recursive: true });
  const exe = join(out, EXE_NAME);
  copyFileSync(built, exe);

  console.log("\n  Signing …");
  run("npx", ["tauri", "signer", "sign", "-f", KEY, "-p", '""', `"${exe}"`]);
  const sigFile = `${exe}.sig`;
  if (!existsSync(sigFile)) die("Signing produced no .sig — the release would be rejected by every client.");

  writeLatest(out, version, readFileSync(sigFile, "utf8").trim());
  writeFileSync(join(out, "SHA256.txt"), shaOf(exe) + ` *${EXE_NAME}\n`);

  console.log(`\n  Ready: dist/release/${version}\n`);
  console.log(`  Upload ${EXE_NAME}, ${EXE_NAME}.sig and latest.json to a GitHub release`);
  console.log(`  tagged v${version}, marked "latest". Then verify:`);
  console.log(`    curl -sL https://github.com/${REPO}/releases/latest/download/latest.json\n`);
}

function shaOf(file) {
  return execFileSync("certutil", ["-hashfile", file, "SHA256"], { encoding: "utf8" })
    .split("\n")[1]
    .trim()
    .replace(/\s/g, "")
    .toLowerCase();
}

function writeLatest(dir, version, signature, notes) {
  writeFileSync(
    join(dir, "latest.json"),
    JSON.stringify(
      {
        version,
        notes: notes ?? `DynastyWire ${version}`,
        pub_date: new Date().toISOString(),
        platforms: {
          "windows-x86_64": {
            signature,
            url: `https://github.com/${REPO}/releases/download/v${version}/${EXE_NAME}`,
          },
        },
      },
      null,
      2
    ) + "\n"
  );
}

function rollback(target) {
  if (!target) die("Usage: node scripts/release.mjs rollback <version>");
  const dir = join(RELEASES, target);
  if (!existsSync(dir)) {
    die(`No dist/release/${target}. Rollback targets are the release folders you kept — have: ${readdirSync(RELEASES).join(", ")}`);
  }
  const manifest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));

  // Re-stamp pub_date so clients treat this as the newest manifest. `version` stays the
  // OLDER one — that is what makes a client sitting on the bad build install this instead.
  manifest.pub_date = new Date().toISOString();
  manifest.notes = `Rolled back to ${target}`;
  const out = join(RELEASES, `rollback-to-${target}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\n  Rollback manifest: dist/release/rollback-to-${target}/latest.json\n`);
  console.log("  1. Unmark the BAD release as 'latest' on GitHub (or delete its latest.json).");
  console.log(`  2. Upload this latest.json to the v${target} release and mark THAT one 'latest'.`);
  console.log("  3. Clients pick it up on next launch. Artifacts are immutable — nothing to rebuild.\n");
  console.log("  LIMIT: a tester who already installed the bad build stays on it until they");
  console.log("  relaunch. There is no remote kill switch without a server.\n");
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "prepare") prepare();
else if (cmd === "rollback") rollback(arg);
else die("Usage: node scripts/release.mjs prepare | rollback <version>");
