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

/// Locate the compiled standalone sidecar (dw-ingest.exe) — no Node required. Preferred
/// over the node+cli.js path in packaged builds.
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
        .invoke_handler(tauri::generate_handler![
            validate_save,
            dynasty_snapshot,
            dynasty_delta,
            dynasty_media,
            dynasty_generate,
            dynasty_recruits,
            list_saves,
            archive_save,
            start_watch
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dynasty Wire");
}
