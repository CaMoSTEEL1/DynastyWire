//! Reading a game while it is being played.
//!
//! The save cannot tell us any of this. It is written once per week advance, not per play, so
//! no amount of watching the file ever sees a snap. The screen can, and this reads it.
//!
//! WHAT THIS DELIBERATELY DOES NOT DO: no memory reads, no injection, no hooking, nothing
//! attached to the game process at all. It captures the window the way OBS does and runs the
//! OCR engine that ships inside Windows. That was a hard constraint of the design, because the
//! alternative is the kind of thing anti-cheat exists to stop — and because offsets into
//! another program's memory break on every patch, while a scoreboard stays a scoreboard.
//!
//! Two facts from a real game shape everything here, and neither is obvious from a design:
//!
//!   1. THE SCORE BAR ONLY EXISTS DURING LIVE PLAY. Play-call overlays, replays, cutscenes and
//!      menus have no bar at all. Roughly half of all reads see nothing, so "no read" is the
//!      normal case and must never be reported as the game having changed.
//!
//!   2. OCR OF A SCORE BAR IS NOISY. Real captures include "1 2:00" with the clock split in
//!      half, "O" for zero, "3rd & 1:" with the play clock bleeding into the distance, and
//!      outright junk. Every field below is therefore extracted tolerantly, and NOTHING here
//!      decides an event — the caller confirms a state twice before believing it.

#![cfg(windows)]

use serde::Serialize;
use windows::core::HSTRING;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect, IsWindow};

/// One OCR'd word and where it sat, so a user can find their score bar once and store the crop.
#[derive(Serialize)]
pub struct LiveWord {
    pub text: String,
    pub x: i32,
    pub y: i32,
}

/// The state of the game as the bar reports it. Every field is optional on purpose: a real
/// capture routinely lands mid-transition with half the bar drawn.
#[derive(Serialize, Default)]
pub struct LiveState {
    /// Everything the crop read, before parsing. Kept so a user reporting "it says the wrong
    /// score" can be answered with what was actually on screen.
    pub raw: String,
    pub quarter: Option<String>,
    pub clock: Option<String>,
    pub down: Option<String>,
    pub situation: Option<String>,
    /// Team name -> score. Team names come out of the bar, not from a guess.
    pub scores: Vec<(String, i32)>,
    /// False when no score bar was on screen — the normal case between plays.
    pub on_screen: bool,
}

const GAME_WINDOW: &str = "EA SPORTS\u{2122} College Football 27";

/// The game window, if it is open. Re-found every call rather than cached: the handle goes
/// stale whenever the game changes video mode, and a cached one silently reads a dead window.
fn game_window() -> Option<HWND> {
    unsafe {
        let hwnd = FindWindowW(None, &HSTRING::from(GAME_WINDOW)).ok()?;
        if hwnd.0.is_null() || !IsWindow(Some(hwnd)).as_bool() {
            return None;
        }
        Some(hwnd)
    }
}

struct Frame {
    pixels: Vec<u8>, // BGRA, top-down
    width: i32,
    height: i32,
}

/// Capture a rectangle of the game window into BGRA pixels.
///
/// `scale` upsamples by an integer factor. OCR accuracy climbs sharply with glyph size and a
/// score bar's text is small, so this is the cheapest accuracy available — done here with a
/// StretchBlt-free nearest copy because the OCR engine cares about edges, not smoothness.
fn capture(hwnd: HWND, crop: (i32, i32, i32, i32), scale: i32) -> Result<Frame, String> {
    let (cx, cy, cw, ch) = crop;
    if cw <= 0 || ch <= 0 {
        return Err("crop has no area".into());
    }
    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).map_err(|e| format!("GetWindowRect failed: {e}"))?;

        let screen_dc = GetDC(None);
        if screen_dc.is_invalid() {
            return Err("could not get a screen DC".into());
        }
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        let bmp = CreateCompatibleBitmap(screen_dc, cw, ch);
        let old = SelectObject(mem_dc, bmp.into());

        // Copy straight off the screen at the window's position. A D3D game does not answer
        // PrintWindow, but its pixels are on the desktop like anything else.
        let ok = BitBlt(mem_dc, 0, 0, cw, ch, Some(screen_dc), rect.left + cx, rect.top + cy, SRCCOPY);

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: cw,
                // Negative height asks GDI for a top-down buffer, which is the order
                // SoftwareBitmap wants; bottom-up would render every capture upside down.
                biHeight: -ch,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (cw * ch * 4) as usize];
        let got = GetDIBits(mem_dc, bmp, 0, ch as u32, Some(buf.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);

        let _ = SelectObject(mem_dc, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);

        if ok.is_err() || got == 0 {
            return Err("capture failed".into());
        }

        if scale <= 1 {
            return Ok(Frame { pixels: buf, width: cw, height: ch });
        }
        let (sw, sh) = (cw * scale, ch * scale);
        let mut big = vec![0u8; (sw * sh * 4) as usize];
        for y in 0..sh {
            let src_row = (y / scale) * cw * 4;
            for x in 0..sw {
                let s = (src_row + (x / scale) * 4) as usize;
                let d = ((y * sw + x) * 4) as usize;
                big[d..d + 4].copy_from_slice(&buf[s..s + 4]);
            }
        }
        Ok(Frame { pixels: big, width: sw, height: sh })
    }
}

/// Crush the frame to black and white so the OCR engine has an easy job.
///
/// The bar is not one background. The team with the ball gets its half filled with its own
/// colour, and white numerals on Tennessee orange are markedly harder to read than the same
/// numerals on the bar's usual near-black — in a live capture the possessing team's score went
/// missing on most frames while the other team's read every time. Everything on that bar is
/// white text, so anything bright enough becomes white and everything else becomes black, and
/// the possessing team stops being a second-class citizen.
/// Bright enough to be the bar's white text and not its brightest fill. Measured: the white
/// numerals sit near 250, Tennessee orange near 166, the bar's own background near 25.
const BAR_CUTOFF: u32 = 200;

fn binarise(frame: &mut Frame, cutoff: u32) {
    for px in frame.pixels.chunks_exact_mut(4) {
        // Rec. 601 luma, integer, on BGRA.
        let luma = (px[2] as u32 * 299 + px[1] as u32 * 587 + px[0] as u32 * 114) / 1000;
        let v = if luma >= cutoff { 255 } else { 0 };
        px[0] = v;
        px[1] = v;
        px[2] = v;
        px[3] = 255;
    }
}

/// Run the OCR engine that ships with Windows over a captured frame.
fn ocr(frame: &Frame) -> Result<Vec<LiveWord>, String> {
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &windows::Storage::Streams::DataWriter::new()
            .and_then(|w| {
                w.WriteBytes(&frame.pixels)?;
                w.DetachBuffer()
            })
            .map_err(|e| format!("buffer: {e}"))?,
        BitmapPixelFormat::Bgra8,
        frame.width,
        frame.height,
    )
    .map_err(|e| format!("bitmap: {e}"))?;

    // The engine wants premultiplied alpha; a screen capture has none, so say so explicitly
    // rather than let it interpret the alpha channel as transparency and read a blank frame.
    let bitmap = SoftwareBitmap::ConvertWithAlpha(&bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)
        .map_err(|e| format!("convert: {e}"))?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("no OCR engine: {e}"))?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("ocr: {e}"))?
        .get()
        .map_err(|e| format!("ocr: {e}"))?;

    let mut out = Vec::new();
    for line in result.Lines().map_err(|e| e.to_string())? {
        for word in line.Words().map_err(|e| e.to_string())? {
            let rect = word.BoundingRect().map_err(|e| e.to_string())?;
            out.push(LiveWord {
                text: word.Text().map_err(|e| e.to_string())?.to_string(),
                x: rect.X as i32,
                y: rect.Y as i32,
            });
        }
    }
    Ok(out)
}

// ── Parsing ────────────────────────────────────────────────────────────────────
// Ported from the prototype, where every rule below was earned against a real game rather
// than guessed. See tools/live-prototype/README.md.

/// OCR reads zero as the letter O constantly. Only fix it where a digit is unambiguous —
/// standing alone, or wedged between digits — so team names keep their letters.
fn normalise(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(chars.len());
    for (i, &c) in chars.iter().enumerate() {
        if c == 'O' || c == 'o' {
            let before = if i == 0 { ' ' } else { chars[i - 1] };
            let after = *chars.get(i + 1).unwrap_or(&' ');
            let alone = !before.is_alphabetic() && !after.is_alphabetic();
            let between_digits = before.is_ascii_digit() && after.is_ascii_digit();
            if alone || between_digits {
                out.push('0');
                continue;
            }
        }
        out.push(c);
    }
    out
}

fn find_clock(t: &str) -> Option<String> {
    // Tolerates "1 2:00", which is how the clock reads when OCR splits it mid-glyph.
    let b: Vec<char> = t.chars().collect();
    for i in 0..b.len() {
        if b[i] != ':' || i == 0 || i + 2 >= b.len() {
            continue;
        }
        if !b[i + 1].is_ascii_digit() || !b[i + 2].is_ascii_digit() {
            continue;
        }
        let mut mins = String::new();
        let mut j = i as i32 - 1;
        while j >= 0 && mins.len() < 2 {
            let c = b[j as usize];
            if c.is_ascii_digit() {
                mins.insert(0, c);
            } else if c != ' ' {
                break;
            }
            j -= 1;
        }
        if !mins.is_empty() {
            return Some(format!("{}:{}{}", mins, b[i + 1], b[i + 2]));
        }
    }
    None
}

const ORDINALS: [&str; 5] = ["1st", "2nd", "3rd", "4th", "OT"];

fn find_down(t: &str) -> Option<String> {
    // EVERY occurrence, not just the first. "1st 7:41 39 1st & 10" has the quarter and the
    // down sharing an ordinal, and checking only the first match found the quarter, saw no
    // "&" after it, and reported no down at all.
    for ord in ORDINALS.iter().take(4) {
        let mut from = 0usize;
        while let Some(rel) = t[from..].find(ord) {
            let idx = from + rel;
            let rest = t[idx + ord.len()..].trim_start();
            if let Some(rest) = rest.strip_prefix('&').or_else(|| rest.strip_prefix("and")) {
                let dist: String = rest
                    .trim_start()
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric())
                    .collect();
                // "2nd & IO" is 2nd and 10. Only fix a distance that is already part digits —
                // "GOAL" and "inches" are real distances and must be left alone, and turning
                // one into the other would make the feed announce a down that never changed.
                let dist = if dist.chars().all(|c| c.is_ascii_digit() || matches!(c, 'I' | 'l' | 'O' | 'o')) {
                    dist.replace(['I', 'l'], "1").replace(['O', 'o'], "0")
                } else {
                    dist
                };
                if !dist.is_empty() {
                    return Some(format!("{ord} & {dist}"));
                }
            }
            from = idx + ord.len();
        }
    }
    None
}

/// The quarter is the ordinal that is NOT part of the down and distance.
fn find_quarter(t: &str) -> Option<String> {
    let mut from = 0usize;
    while from < t.len() {
        let found = ORDINALS
            .iter()
            .filter_map(|o| t[from..].find(o).map(|i| (from + i, *o)))
            .min_by_key(|(i, _)| *i);
        let (idx, ord) = found?;
        let after = t[idx + ord.len()..].trim_start();
        if !after.starts_with('&') {
            return Some(ord.to_string());
        }
        from = idx + ord.len();
    }
    None
}

/// Snap an OCR'd team name onto one the save actually has.
///
/// OCR glues stray glyphs onto names constantly - a real capture reads "IKANSAS STATE", with
/// the possession arrow absorbed into the word. Guessing at which leading letters are junk is
/// how you turn TCU into CU. We do not have to guess: the caller knows every team in the
/// league, so the read is matched against that list and the save's spelling wins.
fn snap_to_known(name: &str, known: &[String]) -> Option<String> {
    let squash = |s: &str| -> String {
        s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase()
    };
    let n = squash(name);
    if n.len() < 3 {
        return None;
    }
    let mut best: Option<(usize, &String)> = None;
    for k in known {
        let kk = squash(k);
        if kk.len() < 3 {
            continue;
        }
        // Containment either way: the read may carry extra glyphs, or be missing the tail.
        let hit = n == kk || n.ends_with(&kk) || n.starts_with(&kk) || kk.contains(&n) || n.contains(&kk);
        if hit {
            let score = kk.len().abs_diff(n.len());
            if best.map_or(true, |(b, _)| score < b) {
                best = Some((score, k));
            }
        }
    }
    best.map(|(_, k)| k.clone())
}

fn is_num(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

fn is_dash(s: &str) -> bool {
    matches!(s, "-" | "\u{2013}" | "\u{2014}")
}

/// "13-2" — a team's record, which the bar prints under its name. Never a score.
fn is_record(s: &str) -> bool {
    let mut parts = s.split(|c: char| c == '-' || c == '\u{2013}' || c == '\u{2014}');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(a), Some(b), None) => is_num(a) && is_num(b),
        _ => false,
    }
}

enum Tok {
    Name(String, i32),
    Num(i32, i32),
    Record,
    Junk,
}

/// Team names and scores from the part of the bar left of the quarter box.
///
/// The bar reads `[rank] TEAM [record] SCORE` twice over, and every one of those four fields is
/// a number or looks like one, so the whole job is deciding which number is the score:
///
/// - The RECORD is thrown away outright. It is the only field with a shape of its own ("13-2"),
///   and it sits between the name and the score, so leaving it in made every team's record its
///   score — a 14-14 game read as 13-15.
/// - The RANK is only there for ranked teams, so it cannot be positionally assumed. What gives
///   it away is that it hugs the name it belongs to: a rank badge sits a few pixels left of its
///   team, while a score sits far right of its own team and far left of the next one. So a
///   number is read as a rank only when the following name starts at less than half the
///   distance back to the previous name. That is scale-free, which matters because the same
///   rule has to hold at 1080p and 4K.
///
/// When every word arrives at the same x — the unit tests, and any caller without positions —
/// the geometry test is skipped and the older "first number after a name" rule stands.
fn find_scores(words: &[LiveWord], known: &[String]) -> Vec<(String, i32)> {
    let all: Vec<LiveWord> = words
        .iter()
        .map(|w| {
            // A lone I is how the OCR engine renders the 1 of a rank badge about half the time.
            let t = w.text.trim();
            let text = if t == "I" || t == "l" || t == "|" { "1".to_string() } else { normalise(t) };
            LiveWord { text, x: w.x, y: w.y }
        })
        .collect();
    let positional = all.iter().any(|w| w.x != all.first().map_or(0, |f| f.x));
    let is_ordinal = |w: &LiveWord| ORDINALS.iter().any(|o| w.text.starts_with(o));

    // The bar is one visual row, but the OCR engine returns LINES, and it does not reliably put
    // the whole row in one. A live capture handed back `TENNESSEE KANSAS STATE 21 3rd 5:13 24`
    // — Tennessee's 24 sorted after the quarter, which reading order says is out of the
    // scoreboard entirely. Where a word sits is the truth; what order it arrived in is not.
    let mut head: Vec<LiveWord> = if positional {
        let edge = all.iter().filter(|w| is_ordinal(w)).map(|w| w.x).min();
        all.into_iter().filter(|w| edge.is_none_or(|e| w.x < e)).collect()
    } else {
        all.into_iter().take_while(|w| !is_ordinal(w)).collect()
    };
    head.sort_by_key(|w| w.x);

    let mut toks: Vec<Tok> = Vec::new();
    let mut i = 0;
    while i < head.len() {
        let t = head[i].text.as_str();
        let x = head[i].x;
        // A record arrives as one token as often as three.
        if is_num(t)
            && i + 2 < head.len()
            && is_dash(head[i + 1].text.trim())
            && is_num(head[i + 2].text.trim())
        {
            toks.push(Tok::Record);
            i += 3;
            continue;
        }
        i += 1;
        if is_record(t) {
            toks.push(Tok::Record);
        } else if is_num(t) {
            toks.push(Tok::Num(t.parse().unwrap_or(0), x));
        } else if !t.is_empty() && t.chars().all(|c| c.is_ascii_uppercase() || c == '\'' || c == '.') {
            toks.push(Tok::Name(t.to_string(), x));
        } else {
            toks.push(Tok::Junk);
        }
    }

    let mut out: Vec<(String, i32)> = Vec::new();
    let mut name = String::new();
    let mut name_x: Option<i32> = None;
    // Each team's block carries exactly one record. Passing two without a name in between means
    // a name was missed, and the next number belongs to a team we did not read — captured live
    // as `TENNESSEE 13-2 15-0 21`, which without this hands Kansas State's 21 to Tennessee.
    let mut records = 0;
    for (i, tok) in toks.iter().enumerate() {
        match tok {
            Tok::Record => records += 1,
            Tok::Junk => {
                name.clear();
                name_x = None;
                records = 0;
            }
            Tok::Name(w, x) => {
                if !name.is_empty() {
                    name.push(' ');
                }
                name.push_str(w);
                name_x = Some(*x);
                records = 0;
            }
            Tok::Num(v, x) => {
                let next_name_x = match toks.get(i + 1) {
                    Some(Tok::Name(_, nx)) => Some(*nx),
                    _ => None,
                };
                // A quarter of the distance back, not half: measured on a real bar, a badge sits
                // about 2% of the way and a score about 40%, so there is room to be strict and
                // reason to be — this rule failing open costs a team its score.
                let rank = positional
                    && match (next_name_x, name_x) {
                        (Some(nx), Some(lx)) => (nx - x) * 4 < x - lx,
                        (Some(_), None) => true,
                        _ => false,
                    };
                if !rank && records < 2 && name.trim().len() >= 3 {
                    // An unknown name is still reported, so a save we could not match does not
                    // silently lose its scoreboard.
                    let trimmed = name.trim();
                    let resolved = snap_to_known(trimmed, known).unwrap_or_else(|| trimmed.to_string());
                    out.push((resolved, *v));
                }
                name.clear();
                name_x = None;
                records = 0;
            }
        }
    }
    out
}

fn find_situation(t: &str) -> Option<String> {
    for word in ["KICKOFF", "PUNT", "FIELD GOAL", "TOUCHDOWN", "TIMEOUT", "FLAG", "PENALTY", "PAT"] {
        if t.contains(word) {
            return Some(word.to_string());
        }
    }
    None
}

pub fn parse(words: &[LiveWord], known_teams: &[String]) -> LiveState {
    let raw = words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
    let t = normalise(&raw);
    // Scores are read from the WORDS, not the joined line: where a number sits is what tells a
    // rank badge apart from a score, and joining throws that away.
    let scores = find_scores(words, known_teams);
    let clock = find_clock(&t);
    let down = find_down(&t);
    // Nothing recognisable means no bar was on screen, which is the normal case between plays.
    let on_screen = clock.is_some() || down.is_some() || !scores.is_empty();
    LiveState {
        quarter: find_quarter(&t),
        clock,
        down,
        situation: find_situation(&t),
        scores,
        on_screen,
        raw,
    }
}

// ── Commands ───────────────────────────────────────────────────────────────────

/// Is the game open? Cheap enough to poll, so the UI can show live/offline honestly.
#[tauri::command]
pub fn live_game_running() -> bool {
    game_window().is_some()
}

/// Every word on screen with its position, so a user can find their score bar once. Different
/// resolutions and HUD scales put the bar in different places; this is how that is settled
/// without asking anyone to measure pixels.
#[tauri::command]
pub fn live_calibrate() -> Result<Vec<LiveWord>, String> {
    let hwnd = game_window().ok_or("College Football 27 isn't running.")?;
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect).map_err(|e| e.to_string())? };
    let frame = capture(hwnd, (0, 0, rect.right - rect.left, rect.bottom - rect.top), 1)?;
    ocr(&frame)
}

/// Every word on the whole screen, contrast-crushed the way the bar read is.
///
/// This exists to answer the one question the score bar cannot: WHO. The bar carries a score
/// and a set of chains and no names at all — but the game puts names on screen constantly, on
/// the ball carrier, on post-play graphics, on the play-call screen. None of that is at a
/// fixed place, and it does not need to be: the caller holds both rosters, so anything on
/// screen can simply be matched against the men who are actually in this game.
///
/// Deliberately separate from `live_calibrate`, which finds the score bar and must keep
/// behaving exactly as it did. This one binarises, because that is what made the bar readable
/// and the same white-on-anything problem applies to a name graphic.
#[tauri::command]
pub fn live_screen_words() -> Result<Vec<LiveWord>, String> {
    let hwnd = game_window().ok_or("College Football 27 isn't running.")?;
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect).map_err(|e| e.to_string())? };
    let mut frame = capture(hwnd, (0, 0, rect.right - rect.left, rect.bottom - rect.top), 2)?;
    binarise(&mut frame, BAR_CUTOFF);
    ocr(&frame)
}

/// One read of the score bar. Emits no events and remembers nothing — deciding that something
/// happened needs two agreeing reads, and that belongs to the caller, not here.
#[tauri::command]
pub fn live_read(
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    teams: Option<Vec<String>>,
) -> Result<LiveState, String> {
    let hwnd = game_window().ok_or("College Football 27 isn't running.")?;
    let mut frame = capture(hwnd, (x, y, w, h), 3)?;
    binarise(&mut frame, BAR_CUTOFF);
    Ok(parse(&ocr(&frame)?, &teams.unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const KNOWN: [&str; 4] = ["Utah", "Kansas State", "Ohio State", "TCU"];
    fn parse2(w: &[LiveWord]) -> LiveState {
        let known: Vec<String> = KNOWN.iter().map(|s| s.to_string()).collect();
        super::parse(w, &known)
    }

    fn words(s: &str) -> Vec<LiveWord> {
        s.split_whitespace()
            .map(|t| LiveWord { text: t.to_string(), x: 0, y: 0 })
            .collect()
    }

    // Every string below is a REAL capture from a live game, noise included.

    #[test]
    fn reads_a_clean_bar() {
        let s = parse2(&words("4 UTAH 0 1 KANSAS STATE 0 1st 6:50 35 3rd & 1"));
        assert_eq!(s.quarter.as_deref(), Some("1st"));
        assert_eq!(s.clock.as_deref(), Some("6:50"));
        assert_eq!(s.down.as_deref(), Some("3rd & 1"));
        assert!(s.on_screen);
        assert_eq!(s.scores, vec![("Utah".to_string(), 0), ("Kansas State".to_string(), 0)]);
    }

    #[test]
    fn survives_a_clock_split_in_half() {
        // "1 2:00" is how 12:00 reads when OCR breaks mid-glyph. Seen constantly.
        assert_eq!(parse2(&words("KANSAS STATE 14-0 1st 1 2:00 KICKOFF")).clock.as_deref(), Some("12:00"));
    }

    #[test]
    fn reads_the_letter_O_as_zero_only_where_it_must_be() {
        let s = parse2(&words("UTAH O KANSAS STATE O 1st 12:00"));
        assert_eq!(s.scores, vec![("Utah".to_string(), 0), ("Kansas State".to_string(), 0)]);
        // ...and does not maul a team name that legitimately contains one.
        let s2 = parse2(&words("OHIO STATE 21 1st 5:00"));
        assert_eq!(s2.scores, vec![("Ohio State".to_string(), 21)]);
    }

    #[test]
    fn does_not_confuse_the_down_with_the_quarter() {
        let s = parse2(&words("1st 7:41 39 1st & 10"));
        assert_eq!(s.quarter.as_deref(), Some("1st"));
        assert_eq!(s.down.as_deref(), Some("1st & 10"));
    }

    #[test]
    fn strips_the_play_clock_bleeding_into_the_distance() {
        // Captured verbatim as "3rd & 1:" with the play clock's colon attached.
        assert_eq!(parse2(&words("1st 6:50 35 3rd & 1:")).down.as_deref(), Some("3rd & 1"));
    }

    #[test]
    fn drops_the_rank_badge_rather_than_calling_it_a_score() {
        let s = parse2(&words("4 UTAH 7 1 KANSAS STATE 21 2nd 3:12"));
        assert_eq!(s.scores, vec![("Utah".to_string(), 7), ("Kansas State".to_string(), 21)]);
    }

    #[test]
    fn reports_no_bar_rather_than_an_empty_game() {
        // A cutscene, a play call, a replay. Half of all reads look like this and NONE of them
        // mean the score is zero or the clock stopped.
        assert!(!parse2(&words("")).on_screen);
        assert!(!parse2(&words("KICKOFF CHOOSE NORMAL SQUIB")).on_screen);
    }

    /// Words laid out the way the bar actually lays them out, so the geometry rules are under
    /// test rather than skipped. Pixel figures are measured off a real 1080p capture.
    fn placed(spans: &[(&str, i32)]) -> Vec<LiveWord> {
        spans
            .iter()
            .flat_map(|(s, x0)| {
                let mut x = *x0;
                s.split_whitespace()
                    .map(|t| {
                        let w = LiveWord { text: t.to_string(), x, y: 950 };
                        x += 24 * t.len() as i32;
                        w
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    #[test]
    fn a_record_is_not_a_score() {
        // 14-14 read as 13-15, for a whole quarter, because "13-2" and "15-0" sit between each
        // team's name and its score. Verbatim from a live Tennessee/Kansas State game.
        let s = parse2(&words("II UTAH 13-2 14 1 KANSAS STATE 15-0 21 2nd 6:15 4th"));
        assert_eq!(s.scores, vec![("Utah".to_string(), 14), ("Kansas State".to_string(), 21)]);
    }

    #[test]
    fn a_record_split_into_three_words_is_still_a_record() {
        let s = parse2(&words("UTAH 13 - 2 14 1 KANSAS STATE 15 - 0 21 2nd 6:15"));
        assert_eq!(s.scores, vec![("Utah".to_string(), 14), ("Kansas State".to_string(), 21)]);
    }

    #[test]
    fn a_rank_badge_is_told_from_a_score_by_where_it_sits() {
        // The nastiest read of the drive: Utah's own score was missed, leaving Kansas State's
        // #1 badge as the next number after UTAH. Textually it is indistinguishable from a
        // score; on screen it is nowhere near Utah and touching Kansas State.
        let s = parse2(&placed(&[("UTAH", 100), ("13-2", 300), ("1", 655), ("KANSAS STATE", 680), ("15-0", 900), ("21", 1030)]));
        assert_eq!(s.scores, vec![("Kansas State".to_string(), 21)]);
    }

    #[test]
    fn two_unranked_teams_still_get_their_scores() {
        // No rank badges at all, so a number before a team name IS that team's score. The
        // geometry has to allow this or most of the country's matchups read as nil.
        let s = parse2(&placed(&[("UTAH", 100), ("8-3", 300), ("14", 470), ("KANSAS STATE", 680), ("9-2", 900), ("21", 1030)]));
        assert_eq!(s.scores, vec![("Utah".to_string(), 14), ("Kansas State".to_string(), 21)]);
    }

    #[test]
    fn a_distance_read_as_letters_is_still_a_number() {
        // "2nd & IO", captured repeatedly. Left alone it alternates with "2nd & 10" between
        // frames and the feed calls a new down every second.
        assert_eq!(parse2(&words("3rd 5:13 40 2nd & IO")).down.as_deref(), Some("2nd & 10"));
        // ...but a distance that is a word stays a word.
        assert_eq!(parse2(&words("3rd 5:13 2nd & GOAL")).down.as_deref(), Some("2nd & GOAL"));
    }

    #[test]
    fn a_missed_team_name_does_not_hand_its_score_to_the_other_side() {
        // Verbatim: `II TENNESSEE 13-2 15-0 21`. Kansas State's name was lost, so its 21 sat
        // right behind Tennessee's. Two records with no name between them is the tell.
        let s = parse2(&words("II UTAH 13-2 15-0 21 2nd 0:38 4th"));
        assert_eq!(s.scores, vec![]);
    }

    #[test]
    fn survives_outright_junk() {
        let s = parse2(&words("@ 4 UTAH O e I KANSAS STATE 14-0 1st 1 2:00 KICKOFF"));
        assert!(s.on_screen);
        assert_eq!(s.clock.as_deref(), Some("12:00"));
        assert_eq!(s.situation.as_deref(), Some("KICKOFF"));
    }
}

/// A manual check against a REAL running game. Ignored by default because it needs College
/// Football 27 open and in live play; unit tests above cover the parsing.
///
///   cargo test --lib live_against_a_real_game -- --ignored --nocapture
#[cfg(test)]
mod live_check {
    /// Dump the captured crop to a BMP so a human (or a model) can LOOK at what the OCR engine
    /// was handed. Faster than reasoning about why a digit went missing.
    ///
    ///   cargo test --lib dump_the_crop -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_the_crop() {
        let hwnd = super::game_window().expect("College Football 27 is not running");
        let out = std::env::var("DW_CROP_OUT").unwrap_or_else(|_| "crop.bmp".into());
        let rect: Vec<i32> = std::env::var("DW_CROP")
            .unwrap_or_else(|_| "360,925,1450,70".into())
            .split(',')
            .map(|s| s.trim().parse().unwrap())
            .collect();
        let scale: i32 = std::env::var("DW_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(3);
        let f = super::capture(hwnd, (rect[0], rect[1], rect[2], rect[3]), scale).expect("capture");

        // 32-bit BGRA, negative height = top-down, which is how capture() hands it over.
        let mut bmp = Vec::with_capacity(54 + f.pixels.len());
        let size = 54u32 + f.pixels.len() as u32;
        bmp.extend_from_slice(b"BM");
        bmp.extend_from_slice(&size.to_le_bytes());
        bmp.extend_from_slice(&[0; 4]);
        bmp.extend_from_slice(&54u32.to_le_bytes());
        bmp.extend_from_slice(&40u32.to_le_bytes());
        bmp.extend_from_slice(&f.width.to_le_bytes());
        bmp.extend_from_slice(&(-f.height).to_le_bytes());
        bmp.extend_from_slice(&1u16.to_le_bytes());
        bmp.extend_from_slice(&32u16.to_le_bytes());
        bmp.extend_from_slice(&[0; 24]);
        bmp.extend_from_slice(&f.pixels);
        std::fs::write(&out, &bmp).expect("write bmp");
        println!("wrote {out} ({}x{})", f.width, f.height);
    }

    /// Every word on the screen with the pixel it sits at, for working out where the score
    /// actually lives when a read comes back with team names but no numbers.
    ///
    ///   cargo test --lib dump_the_screen_words -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_the_screen_words() {
        assert!(super::live_game_running(), "College Football 27 is not running");
        for pass in 1..=3 {
            match super::live_calibrate() {
                Ok(words) => {
                    println!("--- pass {pass} ---");
                    let mut band: Vec<_> = words.iter().filter(|w| w.y > 700).collect();
                    band.sort_by_key(|w| (w.y / 20, w.x));
                    for w in band {
                        println!("  ({:>5},{:>5})  {}", w.x, w.y, w.text);
                    }
                }
                Err(e) => println!("pass {pass}: {e}"),
            }
            std::thread::sleep(std::time::Duration::from_millis(1200));
        }
    }

    #[test]
    #[ignore]
    fn live_against_a_real_game() {
        assert!(super::live_game_running(), "College Football 27 is not running");
        for i in 1..=40 {
            let teams: Vec<String> = ["Tennessee", "Kansas State"].iter().map(|s| s.to_string()).collect();
            // Keep in step with DEFAULT_CROP in lib/dynasty/live.ts. Wider than the prototype
            // because down-and-distance sits at the right edge, and TALLER because the score
            // numerals are double-height and a clipped digit is dropped, not misread.
            match super::live_read(350, 930, 1400, 90, Some(teams)) {
                Ok(s) => println!(
                    "{i}: on_screen={} qtr={:?} clock={:?} down={:?} scores={:?}\n   raw: {}",
                    s.on_screen, s.quarter, s.clock, s.down, s.scores, s.raw
                ),
                Err(e) => println!("{i}: {e}"),
            }
            std::thread::sleep(std::time::Duration::from_millis(1500));
        }
    }
}
