# DynastyWire live-game prototype (A): read the HUD off the screen, once per tick.
#
# Nothing here touches the game process - no memory reads, no injection, no hooking. It is a
# screen capture and an OCR pass, which is what OBS and Discord already do, and it is the
# only reason this is safe to run alongside EA's anti-cheat.
#
#   -Calibrate   capture one frame, OCR the WHOLE screen, and print every line with its
#                coordinates so the HUD region can be found. Run this once, in a game.
#   -Region      "x,y,w,h" to crop before OCR. Cropping is what makes this fast and quiet:
#                the full frame is noisy and slow, the score bug is neither.
#   -Interval    seconds between ticks. 1 is plenty; the clock only moves so fast.
param(
  [switch]$Calibrate,
  [string]$Region = "",
  [double]$Interval = 1.0,
  [int]$Ticks = 20
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
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

$proc = Get-Process CollegeFB27 -ErrorAction SilentlyContinue
if (-not $proc) { throw "College Football 27 is not running." }
$rect = New-Object W+RECT
[void][W]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)
$winW = $rect.R - $rect.L; $winH = $rect.B - $rect.T

$crop = $null
if ($Region) {
  # Cast the whole split at once. Piping through ForEach-Object hands back a collection that
  # PowerShell will happily store in the hashtable as an array, and then $crop.w * 2 fails.
  [int[]]$p = $Region -split ','
  $crop = @{ x = [int]$p[0]; y = [int]$p[1]; w = [int]$p[2]; h = [int]$p[3] }
}

$tmp = Join-Path $env:TEMP "dw-live-frame.png"

function Read-Frame {
  $bmp = New-Object System.Drawing.Bitmap($winW, $winH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.L, $rect.T, 0, 0, $bmp.Size)
  $g.Dispose()

  $target = $bmp
  if ($crop) {
    # Upscale the crop 2x: OCR is markedly better on larger glyphs, and a score bug is small.
    # Each argument is parenthesised because PowerShell's comma binds TIGHTER than "*":
    # `$crop.w * 2, $crop.h * 2` parses as `$crop.w * (2, $crop.h) * 2`, i.e. multiply by an
    # array, which fails with a message that points nowhere near the real cause.
    $sub = New-Object System.Drawing.Bitmap(($crop.w * 2), ($crop.h * 2))
    $g2 = [System.Drawing.Graphics]::FromImage($sub)
    $g2.InterpolationMode = 'HighQualityBicubic'
    $g2.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, ($crop.w * 2), ($crop.h * 2))),
      (New-Object System.Drawing.Rectangle($crop.x, $crop.y, $crop.w, $crop.h)),
      [System.Drawing.GraphicsUnit]::Pixel)
    $g2.Dispose()
    $target = $sub
    $bmp.Dispose()
  }
  $target.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $target.Dispose()

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose()
  return $res
}

if ($Calibrate) {
  "window ${winW}x${winH} - every line the screen gives us, with coordinates:"
  $res = Read-Frame
  foreach ($line in $res.Lines) {
    # PowerShell flattens the word collection on some lines, so indexing can hand back an
    # array instead of one word. Select-Object is the form that always yields exactly one.
    $w = $line.Words | Select-Object -First 1
    if ($null -eq $w) { continue }
    "{0,5},{1,5}  {2}" -f [int]$w.BoundingRect.X, [int]$w.BoundingRect.Y, $line.Text
  }
  return
}

# The shapes a scoreboard actually shows. Kept loose on purpose: the point of the prototype
# is to find out which of these survive contact with the real HUD.
$reClock = '\b(\d{1,2}:\d{2})\b'
$reDown  = '\b(1st|2nd|3rd|4th)\s*(?:&|and)\s*(\d{1,2}|goal|Goal|GOAL)\b'
$reQtr   = '\b(1st|2nd|3rd|4th|OT)\b'

$last = ""
for ($i = 1; $i -le $Ticks; $i++) {
  $res = Read-Frame
  $text = ($res.Lines | ForEach-Object { $_.Text }) -join "  "
  $clock = if ($text -match $reClock) { $Matches[1] } else { "--:--" }
  $down  = if ($text -match $reDown)  { "$($Matches[1]) & $($Matches[2])" } else { "-" }
  $nums  = [regex]::Matches($text, '\b\d{1,2}\b') | ForEach-Object { $_.Value }
  $stamp = (Get-Date).ToString("HH:mm:ss")
  $line = "clock $clock | down $down"
  if ($line -ne $last) { "[$stamp] $line"; "         raw: $($text.Substring(0, [Math]::Min(150, $text.Length)))" }
  $last = $line
  Start-Sleep -Seconds $Interval
}
