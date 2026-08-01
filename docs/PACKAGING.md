# Packaging — Windows installer

Build: `npx tauri build` (runs `npm run build` for the static export, compiles the Rust
backend in release, then bundles). Outputs land in
`src-tauri/target/release/bundle/`:

- `msi/Dynasty Wire_<version>_x64_en-US.msi` — MSI installer (~49 MB at 0.1.9)
- `nsis/Dynasty Wire_<version>_x64-setup.exe` — NSIS setup (~37 MB at 0.1.9)

`<version>` comes from `src-tauri/tauri.conf.json` → `version`, NOT package.json — bump it
there or the new bundle overwrites the old one under the same filename. Both bundles grew
past the sizes first noted here once the ingest sidecar's `node_modules` became a bundled
resource.

The **ingest sidecar** (`ingest/` with its `node_modules`: madden-franchise +
@anthropic-ai/sdk + the 12 `gen/` modules) is bundled as a Tauri resource
(`tauri.conf.json` → `bundle.resources`), and the Rust backend resolves it at runtime
via `resource_dir()/ingest/cli.js` (dev falls back to cwd/exe paths; override with
`DW_INGEST_DIR`).

## Node-free on Windows (done)

**Testers do NOT need Node.js installed.** The compiled parser (`ingest/dist/dw-ingest.exe`)
is embedded straight into the app binary with `include_bytes!` (`lib.rs` → `SIDECAR_BYTES`)
and extracted on first use to `<app cache>/dynastywire/dw-ingest-<version>.exe`, re-extracted
only when the app version changes. One self-contained .exe, nothing to keep alongside it.

`node cli.js` survives only as the **non-Windows dev fallback** (`run_sidecar`), so a mac or
Linux dev box still needs Node. Windows — the distributed target — does not.

Because the parser is embedded, `ingest/dist/dw-ingest.exe` must be rebuilt and present
before `npx tauri build`, or the Rust compile fails outright on the missing include.

## Icons / signing
Brand-crimson icons (PNG set + `icon.ico`) generated under `src-tauri/icons/`. The build
is unsigned; code signing (SmartScreen trust) is a release-time step, not done here.
