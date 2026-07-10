//! Parser for EA Sports College Football 27 dynasty saves.
//!
//! Pipeline: raw file -> [`unwrap_container`] (FBCHUNKS + zlib) -> decompressed
//! `FrTk` franchise-table body -> [`FrtkHeader`] -> (later) table directory + records.
//!
//! See `docs/SAVE-FORMAT.md` for the reverse-engineering notes this implements.

use anyhow::{bail, Context, Result};
use std::io::Read;

/// ASCII magic at the start of an on-disk save file.
pub const FBCHUNKS_MAGIC: &[u8; 8] = b"FBCHUNKS";
/// Magic at the start of the decompressed body.
pub const FRTK_MAGIC: &[u8; 4] = b"FrTk";

/// Result of unwrapping the on-disk container: the save's internal name plus the
/// fully-decompressed `FrTk` body.
pub struct Container {
    /// The save's internal name string (e.g. `College-27-RL1-9039126`).
    pub internal_name: String,
    /// Decompressed franchise-table body (~30 MB), starting with `FrTk`.
    pub body: Vec<u8>,
}

/// Take the raw bytes of a `DYNASTY-*` save file and return the decompressed body.
///
/// Layout (verified): `FBCHUNKS` magic, container header, an ASCII internal name,
/// then a zlib stream at offset 82. The payload is compressed, not encrypted.
pub fn unwrap_container(raw: &[u8]) -> Result<Container> {
    if raw.len() < 82 {
        bail!("file too small to be a save ({} bytes)", raw.len());
    }
    if &raw[0..8] != FBCHUNKS_MAGIC {
        bail!(
            "not an FBCHUNKS save (got magic {:02x?})",
            &raw[0..8.min(raw.len())]
        );
    }

    // Recover the ASCII internal name from the header region (offset 8..82).
    // It's a run of printable ASCII; we read the longest such run for display only.
    let internal_name = longest_ascii_run(&raw[8..82]);

    // The top-level zlib stream begins at offset 82 (0x52). Decompress the single
    // large member. We locate the standard zlib header (0x78) defensively in case a
    // future patch shifts the offset by a few bytes.
    let zlib_off = find_zlib_start(raw, 82)
        .context("could not find the zlib stream (expected 0x78 near offset 82)")?;

    let mut decoder = flate2::read::ZlibDecoder::new(&raw[zlib_off..]);
    let mut body = Vec::with_capacity(32 * 1024 * 1024);
    decoder
        .read_to_end(&mut body)
        .context("zlib decompression of save body failed")?;

    if body.len() < 4 || &body[0..4] != FRTK_MAGIC {
        bail!(
            "decompressed body is not FrTk (got {:02x?}, {} bytes)",
            &body[0..4.min(body.len())],
            body.len()
        );
    }

    Ok(Container {
        internal_name,
        body,
    })
}

/// Parsed `FrTk` body header: magic plus the leading big-endian u32 fields.
#[derive(Debug, Clone)]
pub struct FrtkHeader {
    /// The eight big-endian u32 words following the `FrTk` magic.
    pub words: [u32; 8],
}

/// Parse the fixed header at the start of a decompressed `FrTk` body.
pub fn parse_frtk_header(body: &[u8]) -> Result<FrtkHeader> {
    if body.len() < 4 + 32 {
        bail!("body too small for FrTk header ({} bytes)", body.len());
    }
    if &body[0..4] != FRTK_MAGIC {
        bail!("missing FrTk magic");
    }
    let mut words = [0u32; 8];
    for (i, w) in words.iter_mut().enumerate() {
        let o = 4 + i * 4;
        *w = u32::from_be_bytes([body[o], body[o + 1], body[o + 2], body[o + 3]]);
    }
    Ok(FrtkHeader { words })
}

/// Scan forward from `near` for a plausible zlib header byte (0x78).
fn find_zlib_start(raw: &[u8], near: usize) -> Option<usize> {
    // The verified offset is exactly `near`; allow a small forward window for safety.
    for off in near..(near + 8).min(raw.len().saturating_sub(1)) {
        if raw[off] == 0x78 {
            let cmf_flg = u16::from_be_bytes([raw[off], raw[off + 1]]);
            // Valid zlib streams satisfy (CMF*256 + FLG) % 31 == 0 and CM==8.
            if raw[off] & 0x0f == 0x08 && cmf_flg % 31 == 0 {
                return Some(off);
            }
        }
    }
    None
}

/// Longest run of printable ASCII in a slice — used to recover the internal name.
fn longest_ascii_run(bytes: &[u8]) -> String {
    let mut best: (usize, usize) = (0, 0); // (start, len)
    let mut cur_start = 0;
    let mut cur_len = 0;
    for (i, &b) in bytes.iter().enumerate() {
        if (0x20..0x7f).contains(&b) {
            if cur_len == 0 {
                cur_start = i;
            }
            cur_len += 1;
            if cur_len > best.1 {
                best = (cur_start, cur_len);
            }
        } else {
            cur_len = 0;
        }
    }
    String::from_utf8_lossy(&bytes[best.0..best.0 + best.1])
        .trim()
        .to_string()
}
