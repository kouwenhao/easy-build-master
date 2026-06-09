param(
  [string]$OutputDir = $(Join-Path (Split-Path -Parent $PSScriptRoot) 'build')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  Add-Type -AssemblyName System.Drawing
} catch {
  Add-Type -AssemblyName System.Drawing.Common
}

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2

  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  return $path
}

function New-Color {
  param(
    [int]$A,
    [int]$R,
    [int]$G,
    [int]$B
  )

  return [System.Drawing.Color]::FromArgb($A, $R, $G, $B)
}

function Save-PngBytes {
  param(
    [System.Drawing.Bitmap]$Bitmap
  )

  $memoryStream = New-Object System.IO.MemoryStream
  $Bitmap.Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $memoryStream.ToArray()
  $memoryStream.Dispose()
  return ,$bytes
}

function Draw-RoundedBlock {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Brush]$Brush,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-RoundedRectanglePath -X $X -Y $Y -Width $Width -Height $Height -Radius $Radius
  $Graphics.FillPath($Brush, $path)
  $path.Dispose()
}

function New-BrandBitmap {
  param(
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 1024.0

  $outerPath = New-RoundedRectanglePath -X (72 * $scale) -Y (72 * $scale) -Width (880 * $scale) -Height (880 * $scale) -Radius (220 * $scale)
  $outerGradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF((120 * $scale), (96 * $scale))),
    (New-Object System.Drawing.PointF((910 * $scale), (940 * $scale))),
    (New-Color -A 255 -R 12 -G 42 -B 71),
    (New-Color -A 255 -R 88 -G 196 -B 181)
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(4)
  $blend.Colors = @(
    (New-Color -A 255 -R 12 -G 42 -B 71),
    (New-Color -A 255 -R 24 -G 77 -B 122),
    (New-Color -A 255 -R 42 -G 114 -B 163),
    (New-Color -A 255 -R 98 -G 207 -B 189)
  )
  $blend.Positions = [single[]](0.0, 0.38, 0.72, 1.0)
  $outerGradient.InterpolationColors = $blend
  $graphics.FillPath($outerGradient, $outerPath)

  $glowBrushA = New-Object System.Drawing.SolidBrush((New-Color -A 34 -R 255 -G 255 -B 255))
  $graphics.FillEllipse($glowBrushA, 120 * $scale, 118 * $scale, 560 * $scale, 300 * $scale)
  $glowBrushA.Dispose()

  $glowBrushB = New-Object System.Drawing.SolidBrush((New-Color -A 28 -R 168 -G 244 -B 228))
  $graphics.FillEllipse($glowBrushB, 470 * $scale, 534 * $scale, 360 * $scale, 232 * $scale)
  $glowBrushB.Dispose()

  $borderPen = New-Object System.Drawing.Pen((New-Color -A 96 -R 255 -G 255 -B 255), (20 * $scale))
  $graphics.DrawPath($borderPen, $outerPath)
  $borderPen.Dispose()
  $outerGradient.Dispose()
  $outerPath.Dispose()

  $markGradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF((250 * $scale), (230 * $scale))),
    (New-Object System.Drawing.PointF((250 * $scale), (790 * $scale))),
    (New-Color -A 255 -R 250 -G 252 -B 255),
    (New-Color -A 255 -R 214 -G 236 -B 248)
  )

  Draw-RoundedBlock -Graphics $graphics -Brush $markGradient -X (244 * $scale) -Y (238 * $scale) -Width (142 * $scale) -Height (548 * $scale) -Radius (70 * $scale)
  Draw-RoundedBlock -Graphics $graphics -Brush $markGradient -X (244 * $scale) -Y (238 * $scale) -Width (526 * $scale) -Height (132 * $scale) -Radius (66 * $scale)
  Draw-RoundedBlock -Graphics $graphics -Brush $markGradient -X (244 * $scale) -Y (446 * $scale) -Width (398 * $scale) -Height (112 * $scale) -Radius (56 * $scale)
  Draw-RoundedBlock -Graphics $graphics -Brush $markGradient -X (244 * $scale) -Y (654 * $scale) -Width (526 * $scale) -Height (132 * $scale) -Radius (66 * $scale)
  $markGradient.Dispose()

  $accentGradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF((648 * $scale), (612 * $scale))),
    (New-Object System.Drawing.PointF((824 * $scale), (790 * $scale))),
    (New-Color -A 255 -R 132 -G 235 -B 210),
    (New-Color -A 255 -R 208 -G 252 -B 238)
  )
  Draw-RoundedBlock -Graphics $graphics -Brush $accentGradient -X (648 * $scale) -Y (608 * $scale) -Width (192 * $scale) -Height (192 * $scale) -Radius (54 * $scale)
  $accentGradient.Dispose()

  $accentBorder = New-Object System.Drawing.Pen((New-Color -A 86 -R 15 -G 60 -B 84), (10 * $scale))
  $accentBorder.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $accentRect = New-RoundedRectanglePath -X (648 * $scale) -Y (608 * $scale) -Width (192 * $scale) -Height (192 * $scale) -Radius (54 * $scale)
  $graphics.DrawPath($accentBorder, $accentRect)
  $accentRect.Dispose()
  $accentBorder.Dispose()

  $packagePen = New-Object System.Drawing.Pen((New-Color -A 200 -R 14 -G 57 -B 82), (22 * $scale))
  $packagePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $packagePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $packagePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  $graphics.DrawLine($packagePen, 704 * $scale, 668 * $scale, 744 * $scale, 640 * $scale)
  $graphics.DrawLine($packagePen, 784 * $scale, 668 * $scale, 744 * $scale, 640 * $scale)
  $graphics.DrawLine($packagePen, 704 * $scale, 668 * $scale, 704 * $scale, 748 * $scale)
  $graphics.DrawLine($packagePen, 784 * $scale, 668 * $scale, 784 * $scale, 748 * $scale)
  $graphics.DrawLine($packagePen, 704 * $scale, 748 * $scale, 784 * $scale, 748 * $scale)
  $graphics.DrawLine($packagePen, 744 * $scale, 640 * $scale, 744 * $scale, 748 * $scale)
  $packagePen.Dispose()

  $graphics.Dispose()
  return $bitmap
}

function Write-IcoFile {
  param(
    [string]$Path,
    [int[]]$Sizes
  )

  $entries = @()

  foreach ($size in $Sizes) {
    $bitmap = New-BrandBitmap -Size $size
    $entries += [PSCustomObject]@{
      Size = $size
      Bytes = [byte[]](Save-PngBytes -Bitmap $bitmap)
    }
    $bitmap.Dispose()
  }

  $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($fileStream)

  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$entries.Count)

    $offset = 6 + (16 * $entries.Count)

    foreach ($entry in $entries) {
      $dimension = if ($entry.Size -ge 256) { 0 } else { $entry.Size }

      $writer.Write([byte]$dimension)
      $writer.Write([byte]$dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$entry.Bytes.Length)
      $writer.Write([UInt32]$offset)

      $offset += $entry.Bytes.Length
    }

    foreach ($entry in $entries) {
      $writer.Write($entry.Bytes)
    }
  } finally {
    $writer.Dispose()
    $fileStream.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$iconPngPath = Join-Path $OutputDir 'icon.png'
$iconIcoPath = Join-Path $OutputDir 'icon.ico'

$baseBitmap = New-BrandBitmap -Size 1024
try {
  $baseBitmap.Save($iconPngPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $baseBitmap.Dispose()
}

Write-IcoFile -Path $iconIcoPath -Sizes @(16, 24, 32, 48, 64, 128, 256)

Copy-Item -Path $iconIcoPath -Destination (Join-Path $OutputDir 'installerIcon.ico') -Force
Copy-Item -Path $iconIcoPath -Destination (Join-Path $OutputDir 'uninstallerIcon.ico') -Force
Copy-Item -Path $iconIcoPath -Destination (Join-Path $OutputDir 'installerHeaderIcon.ico') -Force
