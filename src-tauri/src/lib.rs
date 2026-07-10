//! Dynasty Wire Tauri backend. The bridge the static frontend uses to reach the parser,
//! diff engine, and generators — replacing the old Next.js API routes + Supabase.
//!
//! - `validate_save` runs natively (save-parser crate) for fast, cheap checks.
//! - `dynasty_snapshot` / `dynasty_delta` / `dynasty_media` shell out to the Node ingest
//!   sidecar (bundled madden-franchise + generators), passing the user's BYO key via env.

use std::path::PathBuf;
use std::process::Command;

/// Fast native check: is this a readable, complete CFB27 dynasty save? Returns the
/// save's internal name on success.
#[tauri::command]
fn validate_save(path: String) -> Result<String, String> {
    let raw = std::fs::read(&path).map_err(|e| format!("reading {path}: {e}"))?;
    let container = save_parser::unwrap_container(&raw).map_err(|e| e.to_string())?;
    Ok(container.internal_name)
}

/// Locate the Node ingest sidecar (ingest/cli.js). Overridable via DW_INGEST_DIR.
fn sidecar_cli() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("DW_INGEST_DIR") {
        let p = PathBuf::from(dir).join("cli.js");
        if p.exists() {
            return Ok(p);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("ingest/cli.js"));
        candidates.push(cwd.join("../ingest/cli.js"));
    }
    if let Ok(exe) = std::env::current_exe() {
        // dev: target/debug/<exe> -> repo root is three levels up
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

/// Run the sidecar with the given args; return stdout (JSON). `api_key` is passed via
/// env, never on the command line.
fn run_sidecar(args: &[String], api_key: Option<&str>) -> Result<String, String> {
    let cli = sidecar_cli()?;
    let mut cmd = Command::new("node");
    cmd.arg("--max-old-space-size=2048").arg(&cli).args(args);
    if let Some(dir) = cli.parent() {
        cmd.current_dir(dir);
    }
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
fn dynasty_snapshot(save_path: String, team: Option<String>) -> Result<String, String> {
    let mut args = vec!["snapshot".to_string(), save_path];
    if let Some(t) = team {
        args.push("--team".into());
        args.push(t);
    }
    run_sidecar(&args, None)
}

#[tauri::command]
fn dynasty_delta(
    before_path: String,
    after_path: String,
    team: Option<String>,
) -> Result<String, String> {
    let mut args = vec!["delta".to_string(), before_path, after_path];
    if let Some(t) = team {
        args.push("--team".into());
        args.push(t);
    }
    run_sidecar(&args, None)
}

#[tauri::command]
fn dynasty_media(
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
    run_sidecar(&args, Some(&api_key))
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
            dynasty_media
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dynasty Wire");
}
