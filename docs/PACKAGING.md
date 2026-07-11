# Packaging — Windows installer

Build: `npx tauri build` (runs `npm run build` for the static export, compiles the Rust
backend in release, then bundles). Outputs land in
`src-tauri/target/release/bundle/`:

- `msi/Dynasty Wire_0.1.0_x64_en-US.msi` — MSI installer (~25 MB)
- `nsis/Dynasty Wire_0.1.0_x64-setup.exe` — NSIS setup (~20 MB)

The **ingest sidecar** (`ingest/` with its `node_modules`: madden-franchise +
@anthropic-ai/sdk + the 12 `gen/` modules) is bundled as a Tauri resource
(`tauri.conf.json` → `bundle.resources`), and the Rust backend resolves it at runtime
via `resource_dir()/ingest/cli.js` (dev falls back to cwd/exe paths; override with
`DW_INGEST_DIR`).

## Known limitation (v1): requires Node.js on the user's machine

The sidecar runs via the system `node`. So the installer is *not yet* fully
self-contained — a user without Node installed can parse nothing. This is the last gap
between "installs" and "just works like a mod."

### Fix (next step): compile the sidecar to a Node-free binary
Bundle a standalone sidecar executable so no system Node is needed. Options, in order of
preference:
1. **Bun** `bun build ingest/cli.js --compile --outfile dw-ingest.exe` — single exe,
   simplest. (Not installed in the current build env.)
2. **pkg / nexe** — similar single-exe output.
3. **Node 25 SEA** — works but awkward because madden-franchise reads on-disk data files
   (schemas, zstd dicts) that must ship alongside the blob.

Then register it as a Tauri `externalBin` sidecar and call it via the sidecar API instead
of `node`. That closes the last gap for a true drag-drop-and-run mod download.

## Icons / signing
Brand-crimson icons (PNG set + `icon.ico`) generated under `src-tauri/icons/`. The build
is unsigned; code signing (SmartScreen trust) is a release-time step, not done here.
