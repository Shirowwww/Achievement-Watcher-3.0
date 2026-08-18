<#
.SYNOPSIS
  Drive and visually verify a running AW Next dev build from the command line.

.DESCRIPTION
  The app is a tray daemon. This script forwards overlay requests, enumerates windows,
  sends input and captures screenshots for runtime checks.

.EXAMPLE
  # Closing a missing overlay must not open one.
  .\tools\aw-probe.ps1 Send -Arguments '--wintype=overlay --appid=0 --description=close'
  .\tools\aw-probe.ps1 Windows          # must NOT list "Achievements Overlay"

.EXAMPLE
  # Close the overlay, then reopen it with the hotkey.
  .\tools\aw-probe.ps1 Key -Keys ESC -FocusMatch 'Achievements Overlay'
  .\tools\aw-probe.ps1 Key -Keys CTRL+SHIFT+K
  .\tools\aw-probe.ps1 Wait -Match 'Achievements Overlay' -TimeoutSeconds 10

.EXAMPLE
  .\tools\aw-probe.ps1 Shot -Match 'Achievements Overlay' -Out .\overlay.png
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('Start', 'Stop', 'Windows', 'Shot', 'Send', 'Key', 'Wait', 'Logs', 'Click', 'Scroll', 'Hover')]
  [string]$Command,

  [string]$Arguments,
  [string]$Match,
  [string]$FocusMatch,
  [string]$Keys,
  [string]$Out,
  [int]$TimeoutSeconds = 20,
  [switch]$Absent,
  [switch]$Screen,
  [int]$Tail = 40,
  # With -Match, X/Y are relative to the matched window.
  [int]$X = 0,
  [int]$Y = 0,
  [switch]$RightClick,
  # Positive scrolls up; negative scrolls down.
  [int]$Notches = -3
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $RepoRoot 'app'
$Electron = Join-Path $AppDir 'node_modules\electron\dist\electron.exe'
$UserData = Join-Path $env:APPDATA 'Achievement Watcher Next'

# Keep the native helper compatible with PowerShell 5.1 and 7.
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class AwProbe {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int c);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  // Without this, Windows virtualizes window rects, screen metrics and SetCursorPos to 96 DPI
  // while PrintWindow and CopyFromScreen still return physical pixels: on a scaled display every
  // capture comes back cropped to the top-left and coordinates read off a shot miss their target.
  public static void MakeDpiAware() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return; } catch {}
    try { SetProcessDPIAware(); } catch {}
  }

  // Chromium renders the UI in one window, so click through the real cursor.
  public static void ClickAt(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);   // LEFTDOWN
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);   // LEFTUP
  }

  // Chromium routes wheel input by hit-test.
  public static void ScrollAt(int x, int y, int notches) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    for (int i = 0; i < System.Math.Abs(notches); i++) {
      mouse_event(0x0800, 0, 0, unchecked((uint)(notches > 0 ? 120 : -120)), UIntPtr.Zero);
      System.Threading.Thread.Sleep(70);
    }
  }

  public static void RightClickAt(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero);   // RIGHTDOWN
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);   // RIGHTUP
  }
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

  // Return the virtual desktop bounds for multi-monitor captures.
  public static int[] VirtualScreen() {
    return new int[] { GetSystemMetrics(76), GetSystemMetrics(77), GetSystemMetrics(78), GetSystemMetrics(79) };
  }

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public class Win {
    public IntPtr Handle; public uint Pid; public string Process; public string Title;
    public int X, Y, Width, Height;
  }

  // Dev builds use the process name "electron".
  public static List<Win> List(string processName) {
    var found = new List<Win>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string proc;
      try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { return true; }
      if (!proc.ToLowerInvariant().Contains(processName.ToLowerInvariant())) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      RECT r; GetWindowRect(h, out r);
      found.Add(new Win {
        Handle = h, Pid = pid, Process = proc, Title = sb.ToString(),
        X = r.Left, Y = r.Top, Width = r.Right - r.Left, Height = r.Bottom - r.Top
      });
      return true;
    }, IntPtr.Zero);
    return found;
  }

}
"@

[AwProbe]::MakeDpiAware()

function Get-Windows {
  [AwProbe]::List('electron')
}

function Select-Windows([string]$pattern) {
  $all = Get-Windows
  if ([string]::IsNullOrWhiteSpace($pattern)) { return $all }
  return $all | Where-Object { $_.Title -like "*$pattern*" }
}

function Format-Windows($list) {
  if (-not $list -or $list.Count -eq 0) { return '  (no matching Electron window)' }
  $list | ForEach-Object { "  pid={0,-6} {1,4}x{2,-4} @{3},{4}  '{5}'" -f $_.Pid, $_.Width, $_.Height, $_.X, $_.Y, $_.Title }
}

# Virtual-key codes for the combos this project actually uses.
$VK = @{
  'CTRL' = 0x11; 'CONTROL' = 0x11; 'SHIFT' = 0x10; 'ALT' = 0x12
  'ESC' = 0x1B; 'ESCAPE' = 0x1B; 'ENTER' = 0x0D; 'RETURN' = 0x0D; 'TAB' = 0x09
  'F4' = 0x73; 'SPACE' = 0x20; 'WIN' = 0x5B; 'PAGEUP' = 0x21; 'PAGEDOWN' = 0x22
  'HOME' = 0x24; 'END' = 0x23; 'UP' = 0x26; 'DOWN' = 0x28; 'LEFT' = 0x25; 'RIGHT' = 0x27
}
function Get-VK([string]$name) {
  $n = $name.Trim().ToUpperInvariant()
  if ($VK.ContainsKey($n)) { return $VK[$n] }
  if ($n.Length -eq 1) { return [int][char]$n }
  throw "Unknown key '$name'"
}

# Focus the window and verify it before sending input.
function Set-Foreground([IntPtr]$handle) {
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    [AwProbe]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [AwProbe]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [void][AwProbe]::ShowWindow($handle, 9)   # SW_RESTORE
    [void][AwProbe]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 250
    if ([AwProbe]::GetForegroundWindow() -eq $handle) { return $true }
  }
  return $false
}

# All input commands require a focused target.
function Get-InputTarget([string]$pattern, [string]$what) {
  $target = Select-Windows $pattern | Select-Object -First 1
  if (-not $target) { Write-Host "FAIL: no window matching '$pattern'"; exit 1 }
  if (-not (Set-Foreground $target.Handle)) { Write-Host "FAIL: could not focus '$pattern'; $what NOT delivered"; exit 1 }
  return $target
}

switch ($Command) {

  'Start' {
    if ((Get-Process electron -ErrorAction SilentlyContinue)) {
      Write-Host 'An Electron instance is already running; Stop it first to get a clean state.'
    }
    # Remove the flag that disables Electron's GUI.
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    # Launch Electron directly so the shell is not kept alive. -WindowStyle Hidden must NOT be used
    # here: Windows applies that show-state hint to the child process's own first top-level window,
    # so the app's main window comes up with isVisible()=false and never recovers on its own (the
    # app's later BrowserWindow.show() does not override it) - electron.exe has no console window to
    # hide in the first place, so the flag serves no purpose here and only breaks the launch.
    Start-Process -FilePath $Electron -ArgumentList '.' -WorkingDirectory $AppDir

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      if (Select-Windows 'AW Next') { break }
      Start-Sleep -Milliseconds 500
    }
    Write-Host 'Windows now visible:'
    Format-Windows (Get-Windows)
  }

  'Stop' {
    $killed = 0
    Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*Achievement-Watcher*' } |
      ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $killed++ } catch {} }
    Write-Host "stopped $killed process(es)"
  }

  'Windows' { Format-Windows (Select-Windows $Match) }

  'Send' {
    if (-not $Arguments) { throw 'Send requires -Arguments (e.g. ''--wintype=overlay --appid=0 --description=close'')' }
    # The running instance owns the single-instance lock, so this process forwards its argv and
    # exits - the same path the Watchdog uses via SpawnOverlayNotification.
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Push-Location $AppDir
    try {
      $argv = @('.') + ($Arguments -split '\s+' | Where-Object { $_ })
      & $Electron @argv | Out-Null
      Write-Host "forwarded: $Arguments"
    } finally { Pop-Location }
  }

  'Key' {
    if (-not $Keys) { throw 'Key requires -Keys (e.g. ESC, CTRL+SHIFT+K, ALT+F4)' }
    if ($FocusMatch) { [void](Get-InputTarget $FocusMatch 'keys') }
    $parts = $Keys -split '\+' | Where-Object { $_ }
    $codes = $parts | ForEach-Object { Get-VK $_ }
    foreach ($c in $codes) { [AwProbe]::keybd_event([byte]$c, 0, 0, [UIntPtr]::Zero) }      # down, in order
    Start-Sleep -Milliseconds 60
    [array]::Reverse($codes)
    foreach ($c in $codes) { [AwProbe]::keybd_event([byte]$c, 0, 2, [UIntPtr]::Zero) }      # up, reversed
    Write-Host "sent keys: $Keys$(if ($FocusMatch) { " (focused '$FocusMatch')" })"
  }

  'Click' {
    # X/Y are window-relative when -Match is given, absolute otherwise.
    $sx = $X; $sy = $Y
    if ($Match) { $w = Get-InputTarget $Match 'click'; $sx += $w.X; $sy += $w.Y }
    if ($RightClick) { [AwProbe]::RightClickAt($sx, $sy) } else { [AwProbe]::ClickAt($sx, $sy) }
    Write-Host "$(if ($RightClick) { 'right-' })clicked at $sx,$sy$(if ($Match) { " (window '$Match' + $X,$Y)" })"
  }

  'Scroll' {
    $sx = $X; $sy = $Y
    if ($Match) { $w = Get-InputTarget $Match 'scroll'; $sx += $w.X; $sy += $w.Y }
    [AwProbe]::ScrollAt($sx, $sy, $Notches)
    Write-Host "scrolled $Notches notch(es) at $sx,$sy"
  }

  'Hover' {
    # Native submenus open on hover, and a click on the parent item closes the whole menu instead -
    # so reaching one needs a cursor move with no button press. Coordinates are absolute here: a
    # popup menu is its own window, not a child of the app's.
    [void][AwProbe]::SetCursorPos($X, $Y)
    Write-Host "hovering $X,$Y"
  }

  'Wait' {
    if (-not $Match) { throw 'Wait requires -Match' }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      $hit = Select-Windows $Match
      if ($Absent -and -not $hit) { Write-Host "OK: no window matching '$Match'"; exit 0 }
      if (-not $Absent -and $hit) { Write-Host "OK: window present"; Format-Windows $hit; exit 0 }
      Start-Sleep -Milliseconds 400
    }
    Write-Host "TIMEOUT after ${TimeoutSeconds}s: '$Match' was $(if ($Absent) { 'still present' } else { 'never found' })"
    Format-Windows (Get-Windows)
    exit 1
  }

  'Shot' {
    if (-not $Out) { $Out = Join-Path (Get-Location) ('aw-shot-{0:yyyyMMdd-HHmmss}.png' -f (Get-Date)) }
    Add-Type -AssemblyName System.Drawing
    if ($Screen) {
      $vs = [AwProbe]::VirtualScreen()
      $bmp = New-Object System.Drawing.Bitmap $vs[2], $vs[3]
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($vs[0], $vs[1], 0, 0, (New-Object System.Drawing.Size $vs[2], $vs[3]))
      $g.Dispose()
    } else {
      if (-not $Match) { throw 'Shot requires -Match (window title) or -Screen' }
      $w = Select-Windows $Match | Select-Object -First 1
      if (-not $w) { throw "no window matching '$Match'" }
      [void](Set-Foreground $w.Handle)
      Start-Sleep -Milliseconds 400
      # PW_RENDERFULLCONTENT (2) is what makes this work on Chromium/DWM-composited windows;
      # without it an Electron window captures as a blank rectangle.
      $bmp = New-Object System.Drawing.Bitmap $w.Width, $w.Height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $hdc = $g.GetHdc()
      try { [void][AwProbe]::PrintWindow($w.Handle, $hdc, 2) } finally { $g.ReleaseHdc($hdc) }
      $g.Dispose()
    }
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "saved $Out ($((Get-Item $Out).Length) bytes)"
  }

  'Logs' {
    Get-ChildItem (Join-Path $UserData 'logs') -Filter *.log | ForEach-Object {
      Write-Host "`n=== $($_.Name) (last $Tail) ==="
      Get-Content $_.FullName -Tail $Tail -ErrorAction SilentlyContinue
    }
  }
}
