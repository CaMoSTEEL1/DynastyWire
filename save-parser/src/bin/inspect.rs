//! Milestone-1 inspector: load a real save, decompress it, and print the FrTk header.
//!
//! Usage: `cargo run --bin sp-inspect -- "<path to DYNASTY-* save>"`

use anyhow::{Context, Result};
use save_parser::{parse_frtk_header, unwrap_container};

fn main() -> Result<()> {
    let path = std::env::args()
        .nth(1)
        .context("usage: sp-inspect <path-to-dynasty-save>")?;

    let raw = std::fs::read(&path).with_context(|| format!("reading {path}"))?;
    println!("file: {path}");
    println!("on-disk size: {} bytes", raw.len());

    let container = unwrap_container(&raw).context("unwrapping container")?;
    println!("internal name: {}", container.internal_name);
    println!("decompressed body: {} bytes", container.body.len());

    let header = parse_frtk_header(&container.body).context("parsing FrTk header")?;
    println!("FrTk header words (big-endian u32):");
    for (i, w) in header.words.iter().enumerate() {
        println!("  [{i}] = 0x{w:08x}  ({w})");
    }

    // Sanity proof: count how often a few well-known schools appear in the body,
    // to confirm we are looking at real, readable dynasty data.
    let body = &container.body;
    for school in ["Texas", "Michigan", "Georgia", "Alabama", "Oregon"] {
        let n = count_occurrences(body, school.as_bytes());
        println!("  school \"{school}\" appears {n}x in body");
    }

    Ok(())
}

fn count_occurrences(haystack: &[u8], needle: &[u8]) -> usize {
    if needle.is_empty() || haystack.len() < needle.len() {
        return 0;
    }
    let mut count = 0;
    let mut i = 0;
    while i + needle.len() <= haystack.len() {
        if &haystack[i..i + needle.len()] == needle {
            count += 1;
            i += needle.len();
        } else {
            i += 1;
        }
    }
    count
}
