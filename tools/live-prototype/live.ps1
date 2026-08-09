# DynastyWire live game reader - prototype A.
#
# Reads the on-screen score bar and turns consecutive reads into EVENTS. Nothing here touches
# the game process: screen capture plus the OCR engine built into Windows, which is what OBS
# and Discord already do, and the reason this is safe next to EA's anti-cheat.
#
# Two things learned from a real game that shape the whole design:
#
#   1. The score bar only exists during live play. Play-call overlays, replays, cutscenes and
#      menus have no bar at all, so "no read" is the normal case and must never be treated as
#      the game changing. Roughly half of ticks see nothing.
#
#   2. OCR of a score bar is NOISY. Real reads from a live game include "1 2:00" with the
#      clock split, "O" for zero, and junk like "@ 4 UTAH O e I KANSAS STATE". Exact matching
#      is useless. Everything below is written to survive that, and an event is only emitted
#      once the same new state has been seen twice - a single flickery frame is not a
#      touchdown.
#
# Event vocabulary follows Bandroom's trigger map (used with KingSupremeLIVE's permission).
param(
  [string]$Region = "600,930,1060,60",
  [double]$Interval = 1.0,
  [int]$Seconds = 120,
  [switch]$Raw
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LW {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $t) { $asTask.MakeGenericMethod($t).Invoke($null, @($op)).GetAwaiter().GetResult() }

[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw "No OCR language installed." }

[int[]]$rp = $Region -split ','
$cx = [int]$rp[0]; $cy = [int]$rp[1]; $cw = [int]$rp[2]; $ch = [int]$rp[3]
$tmp = Join-Path $env:TEMP "dw-live.png"

function Get-WindowRect {
  $p = Get-Process CollegeFB27 -ErrorAction SilentlyContinue
  if (-not $p) { return $null }
  $r = New-Object LW+RECT
  # The handle goes stale when the game changes video mode, so it is re-read every tick
  # rather than cached - Bandroom's own log shows it losing the window the same way.
  if (-not [LW]::GetWindowRect($p.MainWindowHandle, [ref]$r)) { return $null }
  return $r
}

function Read-Bar($rect) {
  $w = $rect.R - $rect.L; $h = $rect.B - $rect.T
  if ($w -le 0 -or $h -le 0) { return "" }
  $full = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($full)
  $g.CopyFromScreen($rect.L, $rect.T, 0, 0, $full.Size)
  $g.Dispose()

  # Upscale 3x. The bar's glyphs are small and OCR accuracy climbs sharply with size; this is
  # the single cheapest accuracy win available.
  $sub = New-Object System.Drawing.Bitmap(($cw * 3), ($ch * 3))
  $g2 = [System.Drawing.Graphics]::FromImage($sub)
  $g2.InterpolationMode = 'HighQualityBicubic'
  $g2.DrawImage($full,
    (New-Object System.Drawing.Rectangle(0, 0, ($cw * 3), ($ch * 3))),
    (New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)),
    [System.Drawing.GraphicsUnit]::Pixel)
  $g2.Dispose(); $full.Dispose()
  $sub.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $sub.Dispose()

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
  $st = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($st)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bm = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bm)) ([Windows.Media.Ocr.OcrResult])
  $st.Dispose()
  return (($res.Lines | ForEach-Object { $_.Text }) -join " ")
}

function Parse-Bar($text) {
  if (-not $text) { return $null }
  # OCR reads zero as the letter O constantly. Only fix it where a digit is unambiguous:
  # standing alone, or wedged between digits.
  $t = $text -replace '(?<=\s|^)O(?=\s|$)', '0' -replace '(?<=\d)O(?=\d)', '0'
  $t = $t -replace '\s+', ' '

  $clock = $null
  if ($t -match '(\d{1,2})\s?:\s?(\d{2})') { $clock = "{0}:{1}" -f $Matches[1], $Matches[2] }

  $down = $null
  if ($t -match '\b(1st|2nd|3rd|4th)\s*&\s*(\d{1,2}|Goal|GOAL|goal)\b') {
    $down = "$($Matches[1]) & $(($Matches[2] -replace '[^0-9A-Za-z]',''))"
  }

  # The quarter is the ordinal that is NOT part of the down-and-distance.
  $qtr = $null
  foreach ($m in [regex]::Matches($t, '\b(1st|2nd|3rd|4th|OT)\b')) {
    $after = $t.Substring($m.Index + $m.Length)
    if ($after -notmatch '^\s*&') { $qtr = $m.Value; break }
  }

  # The bar reads "[rank] TEAM [score]  [rank] TEAM [score]", and that leading rank is why a
  # naive "caps then number" match swallowed both teams into a single name. Cut the tail
  # (quarter, clock, play clock, down) off first, then read pairs from what remains.
  $head = $t
  $qm = [regex]::Match($t, '(1st|2nd|3rd|4th|OT)')
  if ($qm.Success) { $head = $t.Substring(0, $qm.Index) }
  $scores = @{}
  foreach ($m in [regex]::Matches($head, '([A-Z][A-Z\.'' ]{2,22}?)\s+(\d{1,2})(?=\s|$)')) {
    $name = ($m.Groups[1].Value -replace '^[0-9]+\s*', '').Trim()
    if ($name.Length -ge 3) { $scores[$name] = [int]$m.Groups[2].Value }
  }

  $situation = $null
  foreach ($w in @('KICKOFF', 'PUNT', 'FIELD GOAL', 'PAT', 'TOUCHDOWN', 'TIMEOUT', 'FLAG', 'PENALTY')) {
    if ($t -match $w) { $situation = $w; break }
  }

  if (-not $clock -and -not $down -and $scores.Count -eq 0) { return $null }
  return @{ clock = $clock; down = $down; qtr = $qtr; scores = $scores; situation = $situation; raw = $t }
}

# ---- the loop -------------------------------------------------------------------
$prev = $null        # last CONFIRMED state
$candidate = $null   # a new state seen once, waiting for a second sighting
$blind = 0
$deadline = (Get-Date).AddSeconds($Seconds)
"watching the score bar - crop ${cx},${cy} ${cw}x${ch}, every ${Interval}s"
"(no read is normal: play calls, replays and cutscenes have no bar)"
""

while ((Get-Date) -lt $deadline) {
  $rect = Get-WindowRect
  if (-not $rect) { Start-Sleep -Seconds $Interval; continue }
  $text = Read-Bar $rect
  $state = Parse-Bar $text
  $stamp = (Get-Date).ToString("HH:mm:ss")

  if ($Raw -and $text) { "[$stamp] raw: $text" }

  if (-not $state) { $blind++; Start-Sleep -Seconds $Interval; continue }

  $key = "$($state.qtr)|$($state.clock)|$($state.down)|$(($state.scores.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ',')"

  if ($null -eq $prev) {
    $prev = $state; $prev.key = $key
    "[$stamp] LOCKED ON  $($state.qtr) $($state.clock)  $($state.down)  $(($state.scores.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)" }) -join '  ')"
    Start-Sleep -Seconds $Interval; continue
  }

  if ($key -eq $prev.key) { Start-Sleep -Seconds $Interval; continue }

  # Confirm before believing: one flickery frame is not an event.
  if ($null -eq $candidate -or $candidate.key -ne $key) {
    $candidate = $state; $candidate.key = $key
    Start-Sleep -Seconds $Interval; continue
  }

  # Seen twice - it is real. Work out what changed.
  foreach ($team in $state.scores.Keys) {
    if ($prev.scores.ContainsKey($team)) {
      $delta = $state.scores[$team] - $prev.scores[$team]
      if ($delta -gt 0) {
        $what = switch ($delta) {
          6 { "TOUCHDOWN" } 7 { "TOUCHDOWN + PAT" } 8 { "TOUCHDOWN + 2PT" }
          3 { "FIELD GOAL" } 2 { "SAFETY or 2PT" } 1 { "PAT" } default { "SCORE +$delta" }
        }
        "[$stamp] $what  -- $team now $($state.scores[$team])"
      }
    }
  }
  if ($state.down -and $prev.down -and $state.down -ne $prev.down) {
    if ($state.down -match '^1st') { "[$stamp] FIRST DOWN  ($($state.down))" }
    else { "[$stamp] down: $($state.down)" }
  }
  if ($state.qtr -and $prev.qtr -and $state.qtr -ne $prev.qtr) { "[$stamp] START OF $($state.qtr) QUARTER" }
  if ($state.situation -and $state.situation -ne $prev.situation) { "[$stamp] $($state.situation)" }

  $prev = $state; $prev.key = $key
  $candidate = $null
  Start-Sleep -Seconds $Interval
}
""
"done. ticks with no bar on screen: $blind"
