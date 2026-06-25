param(
  [Parameter(Mandatory = $true)][int]$Modifiers,
  [Parameter(Mandatory = $true)][int]$KeyCode,
  [Parameter(Mandatory = $true)][int]$ParentPid
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class AchievementHotkeyWindow : NativeWindow, IDisposable
{
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID = 0x4157;
    private bool registered;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint key);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public event EventHandler Pressed;

    public AchievementHotkeyWindow()
    {
        CreateHandle(new CreateParams());
    }

    public bool Register(uint modifiers, uint key)
    {
        registered = RegisterHotKey(Handle, HOTKEY_ID, modifiers, key);
        return registered;
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WM_HOTKEY && message.WParam.ToInt32() == HOTKEY_ID) {
            EventHandler handler = Pressed;
            if (handler != null) handler(this, EventArgs.Empty);
        }
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        if (registered) UnregisterHotKey(Handle, HOTKEY_ID);
        DestroyHandle();
    }
}
'@

$window = [AchievementHotkeyWindow]::new()
$parentTimer = [System.Windows.Forms.Timer]::new()
try {
  if (-not $window.Register([uint32]$Modifiers, [uint32]$KeyCode)) {
    [Console]::WriteLine('error:shortcut is already registered by another application')
    exit 2
  }

  $window.add_Pressed({
    [Console]::WriteLine('pressed')
    [Console]::Out.Flush()
  })
  [Console]::WriteLine('ready')
  [Console]::Out.Flush()
  # A forced Watchdog termination cannot run Node cleanup handlers. Polling its PID prevents this
  # helper from becoming an orphan that permanently owns the shortcut until sign-out.
  $parentTimer.Interval = 2000
  $parentTimer.add_Tick({
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
      [System.Windows.Forms.Application]::ExitThread()
    }
  })
  $parentTimer.Start()
  [System.Windows.Forms.Application]::Run()
}
finally {
  $parentTimer.Stop()
  $parentTimer.Dispose()
  $window.Dispose()
}
