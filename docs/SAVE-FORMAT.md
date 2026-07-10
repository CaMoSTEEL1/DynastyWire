# CFB27 Save Format — Reverse-Engineering Notes

Spec for the Rust `save-parser` crate. Everything here was verified against a real
dynasty autosave on 2026-07-06, not assumed.

## Where saves live

```
%USERPROFILE%\OneDrive\Documents\EA SPORTS College Football 27\saves\
```

(OneDrive-redirected Documents on this machine. Non-OneDrive installs use
`%USERPROFILE%\Documents\EA SPORTS College Football 27\saves\`.)

Save slots share one folder, distinguished by filename prefix:

| Prefix          | Meaning                          | Parse target?        |
|-----------------|----------------------------------|----------------------|
| `DYNASTY-*`     | Dynasty mode save                | **Yes — primary**    |
| `RTG-*`         | Road to Glory                    | No (v1)              |
| `ROSTER-*`      | Standalone roster file           | Maybe (roster data)  |
| `PROFILE-*`     | User profile                     | No                   |
| `*-AUTOSAVE`    | Auto-written after events/games  | The watch-folder hook fires on the DYNASTY autosave |

Observed sizes: dynasty save ≈ 9.6 MB on disk, `ROSTER-Official` ≈ 12.5 MB.

## Container layout (on-disk file)

```
offset 0   : "FBCHUNKS"            (8 bytes, ASCII magic — Frostbite chunk container)
offset 8   : 01 00 40 00 ...       (container header)
offset ~29 : "College-27-RL1-9039126"  (save's internal name, ASCII, length-prefixed)
offset 82  : 78 9c ...             (zlib stream — DEFAULT compression)
```

The payload is **zlib-compressed, NOT encrypted.** This is the single most important
fact: no key, no cipher, just DEFLATE. `zlib.decompress(data[82:])` yields the body.

- On-disk zlib stream starts at byte **82** (`0x52`).
- There are ~120 `78 9c` byte pairs in the file, but only the one at offset 82 is the
  real top-level stream; the rest are coincidental byte matches inside compressed data.
  Decompress from 82 and take the single large member (~30 MB out).

## Decompressed body: `FrTk` franchise-table format

Decompressed size ≈ **30 MB**. Begins with:

```
offset 0  : "FrTk"                 (46 72 54 6b — Frostbite franchise-table magic)
offset 4  : big-endian u32 header  observed: 0x80, 0x4, 0x1, 0x2, 0xa60, 0x1, 0xa5f, 0x2
```

This is the **same lineage as Madden franchise files.** All multi-byte integers are
**big-endian**. The body is a directory of tables; each table has a schema and records.

### Field names are FNV-hashed, values are plaintext

Critical for the port:

- Literal field-name strings (`TeamName`, `FirstName`, `LastName`, `CoachFirstName`)
  appear **zero** times in the body. Fields are addressed by **FNV hash** against a
  compiled schema, exactly like the Madden `FrTk`/FTC format.
- **String *values* are in the clear**: player names, school names, etc. Confirmed:
  - School names by raw count in the decompressed body: Texas 224, Michigan 188,
    Georgia 148, Ohio 95, Colorado 84, Alabama 76, Oregon 74, Clemson 45, Notre Dame 39.
  - Roster names appear next to `PlayerStatRecord` (DeAndre, DeMarco, DeVonta, McKinney…).
- Schema/asset type names present in plaintext (≈1,388 distinct): `GameOffensiveStats`,
  `TeamStats`, `SchoolOffer`, `TeamNeedEvaluation`, `RecruitStarLevelChangeSummaryEntry`,
  `PlayerAdvanceSchoolYearEvent`, `ScheduleKnownGame`, `ScheduleStructureEntry`,
  `TeamHistoricalData`, `Stadium`, `PlayerPositionLookupTable`, `PopularityComponentTable`.

### Prior art

The Madden community's franchise-file tooling parses this exact `FrTk` structure and
ships the **compiled schema (FNV field-name → type/offset map)**. The port strategy is to
reuse that schema mapping rather than brute-force every hash. The schema differs per title
version, so CFB27 hashes must be validated against known field values (e.g. find the table
whose records contain the known school strings → that's the team table).

## Parser milestones (crate `save-parser`)

1. **Load + decompress + print FrTk header.** (proves container handling) — DONE / first build.
2. **Enumerate the table directory** (names, record counts, row widths).
3. **Extract the user's dynasty**: school, coach, record, current week/year, schedule.
4. **Extract per-game box scores, roster + stats, recruiting board, rankings** → serde JSON.

## Non-obvious gotchas

- The dynasty save and RTG saves are byte-identical in size (9,646,981) — do **not**
  identify the dynasty by size; use the filename prefix and, after parse, confirm a
  dynasty-only table is present.
- The autosave is rewritten by the game while the game holds the file lock — the
  watch-folder must debounce and wait for the write to settle before reading.
