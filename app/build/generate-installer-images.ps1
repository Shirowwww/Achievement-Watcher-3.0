param(
  [string]$IconPath = (Join-Path $PSScriptRoot 'icon.ico'),
  [string]$LogoPath = (Join-Path $PSScriptRoot '../resources/icon/icon.png'),
  [string]$OutDir = $PSScriptRoot
)

# Regenerate the NSIS MUI2 installer images in the app's Steam Blue palette:
#   installerHeader.bmp  (150 x 57,  header of every installer page)
#   installerSidebar.bmp (164 x 314, welcome/finish page sidebar)
# Run: powershell -ExecutionPolicy Bypass -File build/generate-installer-images.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (Test-Path -LiteralPath $LogoPath) {
  $logoImage = [System.Drawing.Image]::FromFile($LogoPath)
} else {
  $icon = New-Object System.Drawing.Icon($IconPath)
  $logoImage = $icon.ToBitmap()
  $icon.Dispose()
}

function New-InstallerBitmap {
  param(
    [string]$Path,
    [int]$Width,
    [int]$Height,
    [switch]$Sidebar
  )

  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $rect = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
  $dark = [System.Drawing.Color]::FromArgb(255, 21, 32, 45)      # #15202d
  $light = [System.Drawing.Color]::FromArgb(255, 38, 56, 76)     # #26384c
  $accent = [System.Drawing.Color]::FromArgb(255, 91, 141, 255)  # #5b8dff
  $text = [System.Drawing.Color]::FromArgb(255, 217, 223, 228)   # #d9dfe4
  $muted = [System.Drawing.Color]::FromArgb(255, 168, 181, 197)  # #a8b5c5

  # Vertical gradient (sidebar) or horizontal (header).
  $angle = if ($Sidebar) { 90 } else { 0 }
  $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $light, $dark, [Single]$angle)
  $graphics.FillRectangle($gradient, $rect)

  # Soft glow behind the icon.
  $glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(28, 91, 141, 255))
  $glowSize = if ($Sidebar) { 180 } else { 90 }
  $glowX = [int](($Width - $glowSize) / 2)
  $glowY = [int](($Height - $glowSize) / 2)
  $graphics.FillEllipse($glow, $glowX, $glowY, $glowSize, $glowSize)

  # The PNG keeps the sidebar logo sharp; Icon.ToBitmap() picks the 32px ICO frame.
  $iconSize = if ($Sidebar) { 112 } else { 40 }
  $iconX = [int](($Width - $iconSize) / 2)
  $iconY = if ($Sidebar) { 26 } else { [int](($Height - $iconSize) / 2) }
  $graphics.DrawImage($logoImage, $iconX, $iconY, $iconSize, $iconSize)

  if ($Sidebar) {
    $titleFont = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subFont = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Near
    $titleRect = New-Object System.Drawing.RectangleF(12, 150, 140, 60)
    $subRect = New-Object System.Drawing.RectangleF(12, 206, 140, 40)
    $graphics.DrawString('Achievement Watcher', $titleFont, (New-Object System.Drawing.SolidBrush($text)), $titleRect, $format)
    $graphics.DrawString('Track every achievement', $subFont, (New-Object System.Drawing.SolidBrush($muted)), $subRect, $format)
    $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($accent)), 52, 196, 60, 3)
  }

  # Bottom accent line on both images.
  $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($accent)), 0, $Height - 3, $Width, 3)

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $graphics.Dispose()
  $bitmap.Dispose()
}

try {
  New-InstallerBitmap -Path (Join-Path $OutDir 'installerHeader.bmp') -Width 150 -Height 57
  New-InstallerBitmap -Path (Join-Path $OutDir 'installerSidebar.bmp') -Width 164 -Height 314 -Sidebar
} finally {
  $logoImage.Dispose()
}

Write-Host 'Installer images regenerated:'
Write-Host "  $(Join-Path $OutDir 'installerHeader.bmp')"
Write-Host "  $(Join-Path $OutDir 'installerSidebar.bmp')"
