param(
  [string]$IconPath = (Join-Path $PSScriptRoot 'icon.ico'),
  # The bare mark, without the white outline the app icon carries. The header paints the logo white
  # over a dark gradient, so feeding it the outlined icon would flood the whole silhouette - halo
  # included - into one white blob.
  [string]$LogoPath = (Join-Path $PSScriptRoot 'brandMark.png'),
  [string]$SidebarArt = (Join-Path $PSScriptRoot 'installerSidebarArt.png'),
  [string]$OutDir = $PSScriptRoot
)

# Regenerate the NSIS MUI2 installer images in the app's Steam Blue palette:
#   installerHeader.bmp  (150 x 57,  header of every installer page)
#   installerSidebar.bmp (164 x 314, welcome/finish page sidebar)
# Run: powershell -ExecutionPolicy Bypass -File build/generate-installer-images.ps1
#
# The sidebar is the supplied AW Next brand banner (installerSidebarArt.png), fitted to the MUI2
# size rather than drawn here. The procedural sidebar below is only the fallback for a checkout
# without that art. The header stays procedural and picks up whatever logo $LogoPath points at.

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

  # The mark ships as a black glyph on transparency, which would disappear into this dark gradient.
  # Force the colour channels to white and keep the alpha, the same way the brand banner shows it.
  $whiten = New-Object System.Drawing.Imaging.ColorMatrix
  $whiten.Matrix00 = 0
  $whiten.Matrix11 = 0
  $whiten.Matrix22 = 0
  $whiten.Matrix40 = 1
  $whiten.Matrix41 = 1
  $whiten.Matrix42 = 1
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  $attributes.SetColorMatrix($whiten)
  $iconRect = New-Object System.Drawing.Rectangle($iconX, $iconY, $iconSize, $iconSize)
  $graphics.DrawImage($logoImage, $iconRect, 0, 0, $logoImage.Width, $logoImage.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
  $attributes.Dispose()

  if ($Sidebar) {
    $titleFont = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subFont = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Near
    $titleRect = New-Object System.Drawing.RectangleF(12, 150, 140, 60)
    $subRect = New-Object System.Drawing.RectangleF(12, 206, 140, 40)
    $graphics.DrawString('AW Next', $titleFont, (New-Object System.Drawing.SolidBrush($text)), $titleRect, $format)
    $graphics.DrawString('Every achievement. One experience.', $subFont, (New-Object System.Drawing.SolidBrush($muted)), $subRect, $format)
    $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($accent)), 52, 196, 60, 3)
  }

  # Bottom accent line on both images.
  $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($accent)), 0, $Height - 3, $Width, 3)

  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $graphics.Dispose()
  $bitmap.Dispose()
}

# Fit the supplied banner to the MUI2 sidebar: scale to cover, then centre-crop, so the artwork
# keeps its aspect ratio instead of being squashed into the slightly narrower NSIS size.
function New-SidebarFromArt {
  param([string]$Path, [string]$ArtPath, [int]$Width, [int]$Height)

  $art = [System.Drawing.Image]::FromFile($ArtPath)
  try {
    $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $scale = [Math]::Max($Width / $art.Width, $Height / $art.Height)
    $drawW = [int][Math]::Ceiling($art.Width * $scale)
    $drawH = [int][Math]::Ceiling($art.Height * $scale)
    $graphics.DrawImage($art, [int](($Width - $drawW) / 2), [int](($Height - $drawH) / 2), $drawW, $drawH)

    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $graphics.Dispose()
    $bitmap.Dispose()
  } finally {
    $art.Dispose()
  }
}

try {
  New-InstallerBitmap -Path (Join-Path $OutDir 'installerHeader.bmp') -Width 150 -Height 57
  if (Test-Path -LiteralPath $SidebarArt) {
    New-SidebarFromArt -Path (Join-Path $OutDir 'installerSidebar.bmp') -ArtPath $SidebarArt -Width 164 -Height 314
  } else {
    Write-Warning "Brand banner not found at $SidebarArt - drawing the fallback sidebar."
    New-InstallerBitmap -Path (Join-Path $OutDir 'installerSidebar.bmp') -Width 164 -Height 314 -Sidebar
  }
} finally {
  $logoImage.Dispose()
}

Write-Host 'Installer images regenerated:'
Write-Host "  $(Join-Path $OutDir 'installerHeader.bmp')"
Write-Host "  $(Join-Path $OutDir 'installerSidebar.bmp')"
