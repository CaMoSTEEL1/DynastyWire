//! Dynasty Wire Tauri backend. The bridge the static frontend uses to reach the parser,
//! diff engine, and generators — replacing the old Next.js API routes + Supabase.
//!
//! - `validate_save` runs natively (save-parser crate) for fast, cheap checks.
//! - `dynasty_snapshot` / `dynasty_delta` / `dynasty_media` shell out to the Node ingest
//!   sidecar (bundled madden-franchise + generators), passing the user's BYO key via env.

use notify::{EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager};

/// Every outbound HTTP call gets a deadline. Without one, a provider that accepts the
/// connection and then stalls hangs the caller forever — that is what wedged the press
/// conference: `fillTheRoom` awaited a generation that never returned or errored, and the
/// only way out of the room was to skip it.
///
/// `total` bounds the whole request. Generation is genuinely slow (a thinking model writing
/// 2,800 tokens), so it gets minutes; metadata calls get seconds. The connect timeout is
/// short either way, so an unreachable host fails fast instead of burning the full budget.
fn http_client(total_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(total_secs))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("building http client: {e}"))
}

/// Long enough for a slow model to finish a full weekly section, short enough that a stalled
/// provider surfaces as an error the user can act on.
const HTTP_GENERATE_SECS: u64 = 240;
/// Model lists, voice lists — small responses that should never take this long.
const HTTP_META_SECS: u64 = 30;

/// On Windows, keep spawned console processes (the Node parser) from flashing a window
/// and stealing focus from the app / whatever the user is doing. No-op elsewhere.
fn quiet_spawn(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd; // silence unused warning on non-windows
}

/// Fast native check: is this a readable, complete CFB27 dynasty save? Returns the
/// save's internal name on success.
#[tauri::command]
fn validate_save(path: String) -> Result<String, String> {
    let raw = std::fs::read(&path).map_err(|e| format!("reading {path}: {e}"))?;
    let container = save_parser::unwrap_container(&raw).map_err(|e| e.to_string())?;
    Ok(container.internal_name)
}

/// Locate the Node ingest sidecar (ingest/cli.js). In a packaged build it lives in the
/// bundled resource dir; in dev it's found relative to cwd/exe. Overridable via DW_INGEST_DIR.
#[allow(dead_code)]
fn sidecar_cli(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("DW_INGEST_DIR") {
        let p = PathBuf::from(dir).join("cli.js");
        if p.exists() {
            return Ok(p);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Packaged: <resources>/ingest/cli.js
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("ingest/cli.js"));
        candidates.push(res.join("ingest").join("cli.js"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("ingest/cli.js"));
        candidates.push(cwd.join("../ingest/cli.js"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.ancestors().nth(3) {
            candidates.push(root.join("ingest/cli.js"));
        }
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("ingest/cli.js"));
        }
    }
    candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "could not locate ingest/cli.js (set DW_INGEST_DIR)".into())
}

// The save parser is embedded directly in this binary so the app ships as ONE self-contained
// .exe — no separate dw-ingest.exe file to distribute or keep alongside. On first use we
// extract it to a per-version file in the app cache dir and run it from there (a native exe
// can't execute straight from memory on Windows). Re-extracted only when the app version
// changes or the cached copy is missing/corrupt.
#[cfg(windows)]
static SIDECAR_BYTES: &[u8] = include_bytes!("../../ingest/dist/dw-ingest.exe");

#[cfg(windows)]
fn ensure_embedded_sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("dynastywire");
    std::fs::create_dir_all(&dir).map_err(|e| format!("preparing cache dir: {e}"))?;
    let target = dir.join(concat!("dw-ingest-", env!("CARGO_PKG_VERSION"), ".exe"));
    let up_to_date = std::fs::metadata(&target)
        .map(|m| m.len() == SIDECAR_BYTES.len() as u64)
        .unwrap_or(false);
    if !up_to_date {
        std::fs::write(&target, SIDECAR_BYTES).map_err(|e| format!("extracting parser: {e}"))?;
    }
    Ok(target)
}

/// Locate the compiled standalone sidecar (dw-ingest.exe) — no Node required. Preferred
/// over the node+cli.js path in packaged builds.
#[allow(dead_code)]
fn sidecar_exe(app: &tauri::AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "dw-ingest.exe" } else { "dw-ingest" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join(name));
        candidates.push(res.join("ingest").join(name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(name));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("ingest/dist").join(name));
        candidates.push(cwd.join("../ingest/dist").join(name));
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Run the sidecar with the given args; return stdout (JSON). Prefers the compiled exe
/// (Node-free); falls back to `node cli.js` in dev. `api_key` is passed via env only.
fn run_sidecar(app: &tauri::AppHandle, args: &[String], api_key: Option<&str>) -> Result<String, String> {
    // Windows (the distributed target): run the parser embedded in this exe. Elsewhere
    // (dev on mac/linux), fall back to a colocated exe or `node cli.js`.
    #[cfg(windows)]
    let mut cmd = {
        let exe = ensure_embedded_sidecar(app)?;
        let mut c = Command::new(exe);
        c.args(args);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = if let Some(exe) = sidecar_exe(app) {
        let mut c = Command::new(exe);
        c.args(args);
        c
    } else {
        let cli = sidecar_cli(app)?;
        let mut c = Command::new("node");
        c.arg("--max-old-space-size=3072").arg(&cli).args(args);
        if let Some(dir) = cli.parent() {
            c.current_dir(dir);
        }
        c
    };
    if let Some(key) = api_key {
        cmd.env("ANTHROPIC_API_KEY", key);
    }
    quiet_spawn(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("failed to run node sidecar: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "sidecar failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    // The sidecar prints noisy schema warnings to stderr; JSON is the last stdout line.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let json = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| "sidecar produced no JSON".to_string())?;
    Ok(json.to_string())
}

#[tauri::command]
fn dynasty_snapshot(app: tauri::AppHandle, save_path: String, team: Option<String>) -> Result<String, String> {
    let mut args = vec!["snapshot".to_string(), save_path];
    if let Some(t) = team {
        args.push("--team".into());
        args.push(t);
    }
    run_sidecar(&app, &args, None)
}

#[tauri::command]
fn dynasty_recruits(app: tauri::AppHandle, save_path: String) -> Result<String, String> {
    run_sidecar(&app, &["recruits".to_string(), save_path], None)
}

/// League-wide transfer-portal board (real depth-chart + dealbreaker flight-risk read).
#[tauri::command]
fn dynasty_portal(app: tauri::AppHandle, save_path: String) -> Result<String, String> {
    run_sidecar(&app, &["portal".to_string(), save_path], None)
}

/// League-wide commitment tracker: who committed WHERE. Real destinations resolved from the
/// save (Recruit.TopSchoolsList -> ProspectTargetSchool -> highest TeamInfluence).
#[tauri::command]
fn dynasty_commitments(app: tauri::AppHandle, save_path: String) -> Result<String, String> {
    run_sidecar(&app, &["commitments".to_string(), save_path], None)
}

/// The user team's roster (players), so player-specific content uses real names, not invented
/// ones. `team` pins the user's team the same way snapshot/delta do.
#[tauri::command]
fn dynasty_roster(
    app: tauri::AppHandle,
    save_path: String,
    team: Option<String>,
    team_index: Option<i64>,
) -> Result<String, String> {
    let mut args = vec!["roster".to_string(), save_path];
    if let Some(t) = team {
        args.push("--team".into());
        args.push(t);
    }
    // Read ANY team's roster directly (opponent context) — skips user-team detection.
    if let Some(ti) = team_index {
        args.push("--teamIndex".into());
        args.push(ti.to_string());
    }
    run_sidecar(&app, &args, None)
}

/// Consequence Sync: write meter-driven consequences back into the save (player confidence,
/// program points, job security). The sidecar refuses when the game holds the file, backs the
/// save up first, and verifies its writes. `payload` is JSON; base64-encoded for arg safety.
#[tauri::command]
fn dynasty_impact(app: tauri::AppHandle, save_path: String, payload: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let b64 = STANDARD.encode(payload.as_bytes());
    run_sidecar(
        &app,
        &["impact".to_string(), save_path, "--payload".to_string(), b64],
        None,
    )
}

#[tauri::command]
fn dynasty_delta(
    app: tauri::AppHandle,
    before_path: String,
    after_path: String,
    team: Option<String>,
) -> Result<String, String> {
    let mut args = vec!["delta".to_string(), before_path, after_path];
    if let Some(t) = team {
        args.push("--team".into());
        args.push(t);
    }
    run_sidecar(&app, &args, None)
}

#[tauri::command]
fn dynasty_media(
    app: tauri::AppHandle,
    before_path: String,
    after_path: String,
    team: Option<String>,
    coach: Option<String>,
    api_key: String,
) -> Result<String, String> {
    let mut args = vec!["media".to_string(), before_path, after_path];
    if let Some(t) = team {
        args.push("--team".into());
        args.push(t);
    }
    if let Some(c) = coach {
        args.push("--coach".into());
        args.push(c);
    }
    run_sidecar(&app, &args, Some(&api_key))
}

/// List dynasty save files in a folder, newest first (name + modified time millis).
#[tauri::command]
fn list_saves(folder: String) -> Result<Vec<SaveEntry>, String> {
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&folder).map_err(|e| format!("reading {folder}: {e}"))?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("DYNASTY-") {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(SaveEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            modified,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[derive(serde::Serialize)]
struct SaveEntry {
    name: String,
    path: String,
    modified: u64,
}

/// Copy a save into an app-managed archive so the next ingest has a "before" to diff
/// against (the game overwrites the live autosave in place). Returns the archive path.
#[tauri::command]
fn archive_save(path: String, archive_dir: String, label: String) -> Result<String, String> {
    std::fs::create_dir_all(&archive_dir).map_err(|e| e.to_string())?;
    let dest = PathBuf::from(&archive_dir).join(format!("{label}.save"));
    std::fs::copy(&path, &dest).map_err(|e| format!("archiving: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Generic per-kind generation (press-conference, nil, offseason, shows, trophy, …).
/// Dispatches to the sidecar's ingest/gen/<kind>.js module.
#[tauri::command]
fn dynasty_generate(
    app: tauri::AppHandle,
    kind: String,
    before_path: String,
    after_path: String,
    team: Option<String>,
    coach: Option<String>,
    extra: Option<String>,
    api_key: String,
) -> Result<String, String> {
    let mut args = vec!["generate".to_string(), kind, before_path, after_path];
    if let Some(t) = team {
        args.push("--team".into());
        args.push(t);
    }
    if let Some(c) = coach {
        args.push("--coach".into());
        args.push(c);
    }
    if let Some(e) = extra {
        args.push("--extra".into());
        args.push(e);
    }
    run_sidecar(&app, &args, Some(&api_key))
}

/// Call Claude natively (no Node sidecar) for all in-app content generation. This is the
/// path every screen/situation load uses now — a single async HTTPS request, so nothing
/// spawns a process or steals focus on a load. The prompt/context is built in the frontend
/// from the already-parsed snapshot; only the transport lives here so the BYO key stays
/// server-side of the webview. Returns Claude's raw text (the frontend parses the JSON).
/// Sniff an image's media type from its base64 prefix (PNG/JPEG/WebP are what screenshots are).
fn image_media_type(b64: &str) -> &'static str {
    if b64.starts_with("iVBOR") {
        "image/png"
    } else if b64.starts_with("/9j/") {
        "image/jpeg"
    } else {
        "image/webp"
    }
}

#[tauri::command]
async fn claude_complete(
    api_key: String,
    model: Option<String>,
    system: String,
    prompt: String,
    max_tokens: Option<u32>,
    images: Option<Vec<String>>,
    cache_prefix: Option<String>,
) -> Result<String, String> {
    let max_tokens = max_tokens.unwrap_or(1500);

    // We clone the model string so we can own it in the candidates list if needed
    let model_str = model.clone().unwrap_or_else(|| "claude-3-5-sonnet-latest".to_string());

    let candidates = if model_str == "claude-3-5-sonnet-latest" {
        vec![
            "claude-3-5-sonnet-latest".to_string(),
            "claude-3-5-sonnet-20241022".to_string(),
            "claude-3-5-sonnet-20240620".to_string(),
            "claude-3-sonnet-20240229".to_string()
        ]
    } else {
        vec![model_str]
    };

    let client = http_client(HTTP_GENERATE_SECS)?;
    let mut last_err = String::new();

    // `cache_prefix` is the shared week context, identical across every section of an
    // issue. It goes FIRST in the user content with a cache_control breakpoint, so the
    // 2nd..Nth generation of the same week reads it from Anthropic's prompt cache at
    // ~10% of the normal input price instead of re-paying for the full context each time.
    let user_content: serde_json::Value = {
        let mut blocks: Vec<serde_json::Value> = Vec::new();
        if let Some(prefix) = cache_prefix.as_ref().filter(|p| !p.trim().is_empty()) {
            blocks.push(serde_json::json!({
                "type": "text",
                "text": prefix,
                "cache_control": { "type": "ephemeral" }
            }));
        }
        if let Some(imgs) = images.as_ref().filter(|i| !i.is_empty()) {
            for b64 in imgs {
                blocks.push(serde_json::json!({
                    "type": "image",
                    "source": { "type": "base64", "media_type": image_media_type(b64), "data": b64 }
                }));
            }
        }
        if blocks.is_empty() {
            serde_json::Value::String(prompt.clone())
        } else {
            blocks.push(serde_json::json!({ "type": "text", "text": &prompt }));
            serde_json::Value::Array(blocks)
        }
    };

    for m in candidates {
        let body = serde_json::json!({
            "model": m,
            "max_tokens": max_tokens,
            "system": &system,
            "messages": [{ "role": "user", "content": &user_content }],
        });

        let res = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await;

        match res {
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                if status.is_success() {
                    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&text);
                    if let Ok(p) = parsed {
                        let out = p
                            .get("content")
                            .and_then(|c| c.as_array())
                            .map(|blocks| {
                                blocks
                                    .iter()
                                    .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                                    .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                                    .collect::<Vec<_>>()
                                    .join("")
                            })
                            .unwrap_or_default();
                        if !out.is_empty() {
                            return Ok(out);
                        }
                    }
                    last_err = "Claude returned no text content".into();
                } else {
                    last_err = format!("Claude API {status}: {text}");
                    // If it's a 404, we continue to the next fallback candidate.
                    // Otherwise, we break and return the real error immediately.
                    if status.as_u16() != 404 {
                        return Err(last_err);
                    }
                }
            }
            Err(e) => {
                return Err(format!("Claude request failed: {e}"));
            }
        }
    }

    Err(last_err)
}

// ── Self-update, without an installer ───────────────────────────────────────────
//
// Dynasty Wire ships as ONE portable .exe, so Tauri's updater is no use here: on Windows it
// only knows how to apply an NSIS or MSI artifact, and applying one would install a second
// copy beside the portable file rather than replacing it.
//
// This does the swap directly. Windows refuses to delete or overwrite a running .exe but
// DOES allow renaming one, so: rename ourselves aside, drop the new build at our own path,
// relaunch, and sweep the leftover on next start.
//
// The download is verified against a minisign public key compiled into this binary before
// anything touches disk. That is the whole security model for an unsigned app distributed
// over Discord — without it, anyone who can MITM a GitHub download owns every tester's
// machine. An unverified update is never written, never run, and never retried.
// MUST be byte-identical to the decoded contents of the .pub file beside the signing key.
// Transcribed by hand once and the comment line lost a colon; the base64 line was right, so
// it may or may not have verified depending on how strictly the parser reads the header.
// Don't retype this — regenerate it with:
//   python -c "import base64;print(base64.b64decode(open(r'<path>.key.pub').read().strip()).decode())"
const UPDATER_PUBKEY: &str = "untrusted comment: minisign public key: B9A0344076985401\nRWQBVJh2QDSguRuoYgUTYZbr6kO78lALeDj9UOwo9ChxN6rxz5Oqvxz4\n";

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
struct UpdateInfo {
    version: String,
    notes: String,
    url: String,
    /// Base64 of the minisign .sig file for the artifact at `url`.
    signature: String,
}

/// Dotted-numeric compare. Returns true when `candidate` is strictly newer than `current`.
fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split(['.', '-', '+'])
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parse(candidate), parse(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// Read the manifest and report a newer build, if there is one. Any failure is `Ok(None)` —
/// being offline, or a release that hasn't been published yet, is not an error the user
/// should ever see.
#[tauri::command]
async fn update_check(endpoint: String, current: String) -> Result<Option<UpdateInfo>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let res = match client.get(&endpoint).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(None),
    };
    let body: serde_json::Value = match res.json().await {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let version = body.get("version").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if version.is_empty() || !is_newer(&version, &current) {
        return Ok(None);
    }
    let plat = body
        .get("platforms")
        .and_then(|p| p.get("windows-x86_64"))
        .ok_or("manifest has no windows-x86_64 entry")?;
    Ok(Some(UpdateInfo {
        version,
        notes: body.get("notes").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        url: plat.get("url").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        signature: plat.get("signature").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
    }))
}

/// Download, verify, swap, relaunch. Returns only on failure — on success the process is
/// already on its way out.
#[tauri::command]
async fn update_apply(app: tauri::AppHandle, info: UpdateInfo) -> Result<(), String> {
    use base64::Engine;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(&info.url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download failed: {e}"))?;

    // Verify BEFORE anything is written where it could be executed.
    let sig_text = base64::engine::general_purpose::STANDARD
        .decode(info.signature.trim())
        .map_err(|_| "update signature is malformed".to_string())?;
    let sig_text = String::from_utf8(sig_text).map_err(|_| "update signature is malformed".to_string())?;
    let signature = minisign_verify::Signature::decode(&sig_text)
        .map_err(|_| "update signature is malformed".to_string())?;
    let pubkey = minisign_verify::PublicKey::decode(UPDATER_PUBKEY)
        .map_err(|e| format!("bad updater public key: {e}"))?;
    pubkey
        .verify(&bytes, &signature, false)
        .map_err(|_| "update failed verification and was discarded".to_string())?;

    let exe = std::env::current_exe().map_err(|e| format!("locating this app: {e}"))?;
    let staged = exe.with_extension("new");
    std::fs::write(&staged, &bytes).map_err(|e| format!("writing the update: {e}"))?;

    // Windows won't overwrite a running .exe, but it will rename one out of the way.
    let retired = exe.with_extension("old");
    let _ = std::fs::remove_file(&retired);
    std::fs::rename(&exe, &retired).map_err(|e| format!("replacing this app: {e}"))?;
    if let Err(e) = std::fs::rename(&staged, &exe) {
        // Put it back rather than leaving the user with no app at all.
        let _ = std::fs::rename(&retired, &exe);
        return Err(format!("replacing this app: {e}"));
    }

    Command::new(&exe)
        .spawn()
        .map_err(|e| format!("restarting: {e}"))?;
    app.exit(0);
    Ok(())
}

/// Delete the previous build left beside us by the last update. Runs at startup, when the
/// old file is no longer locked.
fn sweep_retired_build() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("old"));
        let _ = std::fs::remove_file(exe.with_extension("new"));
    }
}

/// Call any OpenAI-compatible chat-completions endpoint (OpenAI, OpenRouter, Groq, Together,
/// LM Studio/Ollama local servers, …). The user supplies the provider's v1 base URL + key +
/// model in settings; this is the transport twin of `claude_complete` for those providers.
#[tauri::command]
async fn openai_complete(
    base_url: String,
    api_key: String,
    model: String,
    system: String,
    prompt: String,
    max_tokens: Option<u32>,
    images: Option<Vec<String>>,
) -> Result<String, String> {
    // Tolerate common paste mistakes: whitespace, missing scheme, trailing slash, or the
    // full chat/completions path instead of the /v1 base.
    let trimmed = base_url.trim();
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let base = with_scheme.trim_end_matches('/');
    let url = if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    };
    // With images attached, the user message becomes a multimodal content array (data URLs).
    let user_content: serde_json::Value = match &images {
        Some(imgs) if !imgs.is_empty() => {
            let mut parts: Vec<serde_json::Value> = imgs
                .iter()
                .map(|b64| {
                    serde_json::json!({
                        "type": "image_url",
                        "image_url": { "url": format!("data:{};base64,{}", image_media_type(b64), b64) }
                    })
                })
                .collect();
            parts.push(serde_json::json!({ "type": "text", "text": &prompt }));
            serde_json::Value::Array(parts)
        }
        _ => serde_json::Value::String(prompt.clone()),
    };
    let mut body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_content }
        ],
    });
    // max_tokens is omitted entirely when None — local reasoning models burn their whole
    // budget on thinking if capped, so users can uncap in settings.
    if let Some(mt) = max_tokens {
        body["max_tokens"] = mt.into();
    }

    let client = http_client(HTTP_GENERATE_SECS)?;
    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("provider request failed: {e}"))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("reading provider response: {e}"))?;
    if !status.is_success() {
        // A vision rejection is the one provider error a user can't read: the body is the
        // whole base64 payload's parse failure, megabytes in. Say what actually happened.
        let sent_images = images.as_ref().map_or(false, |i| !i.is_empty());
        let rejected_images = text.contains("image_url")
            || text.contains("image")
                && (text.contains("unknown variant") || text.contains("not supported"));
        if sent_images && rejected_images {
            return Err(format!(
                "This provider rejected the screenshots — the endpoint or model at {url} has no \
                 vision support, so highlight extraction can't work there. Switch Settings → API \
                 keys to Anthropic (Claude reads images), or point the base URL at a \
                 vision-capable model. (provider said: {})",
                text.chars().take(180).collect::<String>()
            ));
        }
        return Err(format!("provider API {status}: {text}"));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        let snippet: String = text.trim().chars().take(200).collect();
        format!(
            "provider returned non-JSON from {url} ({e}). Check the base URL — it must be the \
             provider's OpenAI-compatible endpoint (usually ends in /v1; for Gemini use \
             https://generativelanguage.googleapis.com/v1beta/openai). Response starts: \"{snippet}\""
        )
    })?;
    // Standard shape first; some providers (incl. Gemini reasoning modes) return content as
    // an array of typed parts — join those as a fallback.
    let msg = parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"));
    let out = msg
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .or_else(|| {
            msg.and_then(|m| m.get("content")).and_then(|c| c.as_array()).map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("")
            })
        })
        .unwrap_or_default();
    if out.is_empty() {
        let snippet: String = text.trim().chars().take(200).collect();
        return Err(format!(
            "provider returned no text content (model may have spent its whole token budget on \
             reasoning — try enabling 'uncap max tokens' in settings). Response starts: \"{snippet}\""
        ));
    }
    Ok(out)
}

/// ElevenLabs text-to-speech. Returns the spoken line as base64-encoded MP3 for the webview
/// to play. Opt-in only (podcast audio) — the key is the user's own. Kept server-side of the
/// webview so the key never rides in page JS.
#[tauri::command]
async fn tts_elevenlabs(
    api_key: String,
    voice_id: String,
    text: String,
    previous_text: Option<String>,
    next_text: Option<String>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}");
    // previous_text/next_text = ElevenLabs request stitching: the model hears the lines
    // around this one, so prosody flows across the conversation like one continuous
    // recording instead of isolated clips — the "podcast feel".
    let mut body = serde_json::json!({
        "text": text,
        "model_id": "eleven_turbo_v2_5",
        "voice_settings": { "stability": 0.4, "similarity_boost": 0.75, "style": 0.35 }
    });
    if let Some(prev) = previous_text.filter(|s| !s.trim().is_empty()) {
        body["previous_text"] = serde_json::Value::String(prev);
    }
    if let Some(next) = next_text.filter(|s| !s.trim().is_empty()) {
        body["next_text"] = serde_json::Value::String(next);
    }
    let client = http_client(HTTP_GENERATE_SECS)?;
    let res = client
        .post(&url)
        .header("xi-api-key", &api_key)
        .header("content-type", "application/json")
        .header("accept", "audio/mpeg")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("elevenlabs request failed: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        let snippet: String = text.trim().chars().take(200).collect();
        return Err(format!("elevenlabs API {status}: {snippet}"));
    }
    let bytes = res.bytes().await.map_err(|e| format!("reading audio: {e}"))?;
    Ok(STANDARD.encode(&bytes))
}

/// One voice on the user's ElevenLabs account, trimmed to what voice assignment needs.
#[derive(serde::Serialize)]
struct ElevenVoice {
    voice_id: String,
    name: String,
    category: String,
    /// "male" / "female" / "" — only set when the voice carries a gender label.
    gender: String,
    description: String,
}

fn parse_eleven_voices(parsed: &serde_json::Value) -> Vec<ElevenVoice> {
    parsed
        .get("voices")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let voice_id = v.get("voice_id").and_then(|x| x.as_str())?.to_string();
                    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    if name.is_empty() {
                        return None;
                    }
                    Some(ElevenVoice {
                        voice_id,
                        name,
                        category: v
                            .get("category")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        gender: v
                            .get("labels")
                            .and_then(|l| l.get("gender"))
                            .and_then(|g| g.as_str())
                            .unwrap_or("")
                            .to_lowercase(),
                        description: v
                            .get("description")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn eleven_get_voices(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
) -> Result<Vec<ElevenVoice>, String> {
    let res = client
        .get(url)
        .header("xi-api-key", api_key)
        .send()
        .await
        .map_err(|e| format!("elevenlabs voices request failed: {e}"))?;
    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("reading voices response: {e}"))?;
    if !status.is_success() {
        let snippet: String = text.trim().chars().take(200).collect();
        return Err(format!("elevenlabs API {status}: {snippet}"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("bad JSON from elevenlabs voices: {e}"))?;
    Ok(parse_eleven_voices(&parsed))
}

/// The user's OWN ElevenLabs voices — cloned, designed, or saved from the voice library.
/// Podcast audio assigns from these instead of the premade stock voices, so a user who has
/// built real broadcast voices hears those. An empty list means "nothing custom on this
/// account" and the frontend falls back to the premade pool.
///
/// `voice_type=non-default` asks v2 to drop the stock voices server-side; if that endpoint
/// isn't available for a key, fall back to v1 and filter the premades out here.
#[tauri::command]
async fn elevenlabs_list_voices(api_key: String) -> Result<Vec<ElevenVoice>, String> {
    let client = http_client(HTTP_META_SECS)?;
    match eleven_get_voices(
        &client,
        "https://api.elevenlabs.io/v2/voices?voice_type=non-default&page_size=100",
        &api_key,
    )
    .await
    {
        Ok(v) if !v.is_empty() => return Ok(v),
        // Empty from v2 could be a real "no custom voices" — confirm against v1 before
        // reporting none, since that answer silently downgrades the whole show to premades.
        Ok(_) => {}
        Err(e) => eprintln!("elevenlabs v2 voices failed, falling back to v1: {e}"),
    }
    let all = eleven_get_voices(&client, "https://api.elevenlabs.io/v1/voices", &api_key).await?;
    Ok(all.into_iter().filter(|v| v.category != "premade").collect())
}

/// List the model ids available on an OpenAI-compatible endpoint (GET {base}/models), so
/// users can pick from a live list instead of hand-typing a model id (case-sensitive on
/// most providers). Returns ids sorted alphabetically.
#[tauri::command]
async fn openai_list_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let trimmed = base_url.trim();
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let base = with_scheme.trim_end_matches('/');
    let base = base.trim_end_matches("/chat/completions");
    let url = format!("{base}/models");

    let client = http_client(HTTP_META_SECS)?;
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("models request failed: {e}"))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("reading models response: {e}"))?;

    if !status.is_success() {
        return Err(format!("provider API {status}: {text}"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| {
            let snippet: String = text.trim().chars().take(160).collect();
            format!("provider returned non-JSON from {url} ({e}). Response starts: \"{snippet}\"")
        })?;

    let mut ids: Vec<String> = parsed
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    if ids.is_empty() {
        return Err("no models returned — check the base URL and key".into());
    }

    ids.sort();
    Ok(ids)
}

#[tauri::command]
async fn anthropic_list_models(api_key: String) -> Result<Vec<String>, String> {
    let client = http_client(HTTP_META_SECS)?;
    let res = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("List Anthropic models request failed: {e}"))?;

    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("reading models response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Anthropic API {status}: {text}"));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("bad JSON: {e}"))?;
    let data = parsed
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| "no 'data' array in models response".to_string())?;

    let mut out = Vec::new();
    for item in data {
        if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
            out.push(id.to_string());
        }
    }
    out.sort();
    Ok(out)
}

fn is_dynasty_save(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with("DYNASTY-"))
        .unwrap_or(false)
}

/// Watch the saves folder. When the dynasty autosave changes (and settles + validates),
/// emit a `dynasty-saved` event the frontend listens for to auto-refresh. The game
/// overwrites the autosave in place, so we watch Modify, debounce, and validate.
#[tauri::command]
fn start_watch(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let dir = PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err(format!("not a directory: {folder}"));
    }
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("watcher init failed: {e}");
                return;
            }
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }
        let debounce = std::time::Duration::from_millis(1500);
        let mut pending: Option<PathBuf> = None;
        loop {
            match rx.recv_timeout(debounce) {
                Ok(Ok(event)) => {
                    if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                        for p in event.paths {
                            if is_dynasty_save(&p) {
                                pending = Some(p);
                            }
                        }
                    }
                }
                Ok(Err(_)) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(p) = pending.take() {
                        // Only fire once the file is a complete, readable save.
                        if let Ok(raw) = std::fs::read(&p) {
                            if save_parser::unwrap_container(&raw).is_ok() {
                                let _ = app.emit("dynasty-saved", p.to_string_lossy().to_string());
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            update_check,
            update_apply,
            validate_save,
            dynasty_snapshot,
            dynasty_delta,
            dynasty_media,
            dynasty_generate,
            dynasty_recruits,
            dynasty_portal,
            dynasty_commitments,
            dynasty_roster,
            dynasty_impact,
            claude_complete,
            openai_complete,
            openai_list_models,
            anthropic_list_models,
            tts_elevenlabs,
            elevenlabs_list_voices,
            list_saves,
            archive_save,
            start_watch
        ])
        .setup(|_app| {
            // The previous build is still on disk beside us until now — it was locked while
            // it was the running process.
            sweep_retired_build();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Dynasty Wire");
}

#[cfg(test)]
mod update_tests {
    use super::*;

    #[test]
    fn newer_version_detection() {
        assert!(is_newer("0.1.12", "0.1.11"));
        assert!(is_newer("0.2.0", "0.1.99"));
        assert!(!is_newer("0.1.11", "0.1.11"));
        assert!(!is_newer("0.1.10", "0.1.11")); // 10 < 11, not string-compared
        assert!(is_newer("0.1.11", "0.1.9"));  // 11 > 9, ditto
    }

    /// The release artifact must verify against the key compiled into THIS binary. A
    /// mismatch means every client silently refuses the update, so prove it before
    /// publishing rather than discovering it from a tester.
    #[test]
    fn release_artifact_verifies_against_embedded_key() {
        use base64::Engine;
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/release");
        let Ok(entries) = std::fs::read_dir(&dir) else {
            eprintln!("no dist/release yet — skipping");
            return;
        };
        let mut checked = 0;
        for e in entries.flatten() {
            let exe = e.path().join("DynastyWire.exe");
            let sig = e.path().join("DynastyWire.exe.sig");
            if !exe.exists() || !sig.exists() {
                continue;
            }
            let bytes = std::fs::read(&exe).unwrap();
            // The .sig file is itself base64 of the minisign text — decode before parsing,
            // exactly as `update_apply` does with the manifest's signature field.
            let sig_b64 = std::fs::read_to_string(&sig).unwrap();
            let sig_text = String::from_utf8(
                base64::engine::general_purpose::STANDARD
                    .decode(sig_b64.trim())
                    .expect(".sig is base64"),
            )
            .unwrap();
            let signature = minisign_verify::Signature::decode(&sig_text).expect("sig parses");
            let pubkey = minisign_verify::PublicKey::decode(UPDATER_PUBKEY).expect("pubkey parses");
            pubkey
                .verify(&bytes, &signature, false)
                .unwrap_or_else(|e| panic!("{} FAILED verification: {e}", exe.display()));

            // The manifest must carry that signature verbatim — the .sig file's own text.
            let manifest: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(e.path().join("latest.json")).unwrap())
                    .unwrap();
            let in_manifest = manifest["platforms"]["windows-x86_64"]["signature"]
                .as_str()
                .unwrap();
            assert_eq!(
                in_manifest.trim(),
                sig_b64.trim(),
                "latest.json signature does not match the .sig file"
            );
            checked += 1;
        }
        assert!(checked > 0, "no release artifacts found to verify");
        eprintln!("verified {checked} release artifact(s)");
    }
}
