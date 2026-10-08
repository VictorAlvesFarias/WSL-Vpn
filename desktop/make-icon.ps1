# Draws build/icon.png (512x512): a shield with a padlock on a blue rounded square.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 512
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRect ([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $path
}

# Background.
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(37, 99, 235))), (New-RoundedRect 0 0 $size $size 112))

$white = [System.Drawing.Color]::White
$pen = New-Object System.Drawing.Pen $white, 30
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

# Shield outline.
$shield = New-Object System.Drawing.Drawing2D.GraphicsPath
$shield.AddLine(256, 84, 404, 140)
$shield.AddBezier(404, 140, 404, 290, 350, 380, 256, 432)
$shield.AddBezier(256, 432, 162, 380, 108, 290, 108, 140)
$shield.CloseFigure()
$g.DrawPath($pen, $shield)

# Padlock: shackle + body.
$shackle = New-Object System.Drawing.Pen $white, 20
$g.DrawArc($shackle, 220, 196, 72, 80, 180, 180)
$g.DrawLine($shackle, 220, 236, 220, 262)
$g.DrawLine($shackle, 292, 236, 292, 262)
$g.FillPath((New-Object System.Drawing.SolidBrush $white), (New-RoundedRect 198 252 116 92 24))

$out = Join-Path $PSScriptRoot '..\build\icon.png'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bitmap.Dispose()
Write-Output "Wrote $out"
