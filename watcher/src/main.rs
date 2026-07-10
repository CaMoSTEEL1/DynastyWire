//! Watch the CFB27 saves folder and fire when the *dynasty* autosave changes.
//!
//! Key facts this handles (learned from the real save, see docs/):
//! - The dynasty autosave OVERWRITES the same filename in place, so we watch for
//!   content/modify events, not new files.
//! - Dynasty, Road-to-Glory, Roster, and Profile saves share one folder — we only
//!   care about `DYNASTY-*` files.
//! - The game holds the file lock while writing, so we debounce and only act once the
//!   file has been quiet for a moment, then validate it's a complete FBCHUNKS save.
//!
//! Usage: `dw-watch "<path to .../EA SPORTS College Football 27/saves>"`
//! On a settled dynasty-save change it prints a JSON line the sidecar/Tauri layer
//! consumes to run parse -> diff -> generate.

use anyhow::{Context, Result};
use notify::{EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;

/// Quiet period after the last write before we treat the save as settled.
const DEBOUNCE: Duration = Duration::from_millis(1500);

fn main() -> Result<()> {
    let dir = std::env::args()
        .nth(1)
        .context("usage: dw-watch <saves-folder>")?;
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        anyhow::bail!("not a directory: {}", dir.display());
    }
    eprintln!("watching {}", dir.display());

    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    // Debounce loop: collect events, act once things go quiet.
    let mut pending: Option<PathBuf> = None;
    loop {
        match rx.recv_timeout(DEBOUNCE) {
            Ok(Ok(event)) => {
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                    for path in event.paths {
                        if is_dynasty_save(&path) {
                            pending = Some(path);
                        }
                    }
                }
            }
            Ok(Err(e)) => eprintln!("watch error: {e}"),
            Err(RecvTimeoutError::Timeout) => {
                if let Some(path) = pending.take() {
                    on_settled(&path);
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

/// Is this a dynasty save file (not RTG/Roster/Profile)?
fn is_dynasty_save(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with("DYNASTY-"))
        .unwrap_or(false)
}

/// The dynasty save has settled — validate it and emit an event for the pipeline.
fn on_settled(path: &Path) {
    match validate(path) {
        Ok(name) => {
            // A machine-readable line for the sidecar/Tauri layer to trigger ingest.
            println!(
                "{{\"event\":\"dynasty_saved\",\"path\":{:?},\"save\":{:?}}}",
                path.to_string_lossy(),
                name
            );
        }
        Err(e) => eprintln!("skipping {}: {e}", path.display()),
    }
}

/// Confirm the file is a complete, readable FBCHUNKS dynasty save before firing.
fn validate(path: &Path) -> Result<String> {
    let raw = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let container = save_parser::unwrap_container(&raw).context("not a complete dynasty save yet")?;
    Ok(container.internal_name)
}
