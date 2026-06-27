!include "MUI2.nsh"

Var APPDATA_MYAPP
Var PS_CLOSE_AW

!macro customHeader
  !undef MUI_HEADERIMAGE_BITMAP
  !undef MUI_HEADERIMAGE_BITMAP_RIGHT
  
  !define MUI_HEADERIMAGE_BITMAP "${BUILD_RESOURCES_DIR}\installerSidebar.bmp"
  !define MUI_HEADERIMAGE_BITMAP_RIGHT
!macroend

!macro customInit
  ; Close a previous Achievement Watcher/Watchdog before files are replaced.
  ; Do not kill every node.exe: the Watchdog is selected by its watchdog.js command line.
  ExecWait 'taskkill /IM "Achievement Watcher.exe" /T /F'
  ExecWait 'taskkill /IM "AchievementWatcher.exe" /T /F'
  StrCpy $PS_CLOSE_AW "Get-CimInstance Win32_Process | Where-Object { ($$_.Name -eq 'node.exe' -or $$_.Name -eq 'nw.exe') -and $$_.CommandLine -like '*watchdog.js*' } | ForEach-Object { taskkill /F /T /PID $$_.ProcessId }"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$PS_CLOSE_AW"'
!macroend

!macro customInstall
  ; Copy media, presets, view to your app's AppData
  StrCpy $APPDATA_MYAPP "$APPDATA\Achievement Watcher"
  CreateDirectory "$APPDATA_MYAPP"
  DetailPrint "Keeping existing settings and cache in $APPDATA_MYAPP"
!macroend


