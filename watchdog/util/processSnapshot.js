'use strict';

// Native process enumeration through the Win32 ToolHelp snapshot API (koffi), replacing a
// `tasklist.exe` spawn. The playtime monitor polls the process list every 3 s for the whole life of
// the tray daemon, and `win-tasklist` costs ~440 ms of wall time per call (a child process, a CSV
// round trip and a regex over ~460 rows) - roughly 15 % of a core, permanently. The same snapshot
// through CreateToolhelp32Snapshot costs ~6 ms and spawns nothing.
//
// koffi is already the Watchdog's single FFI backend (regodit / xinput-ffi), so this adds no
// dependency. Everything is wrapped so a koffi load failure only disables the fast path:
// util/tasklist.js falls back to win-tasklist.

const MAX_PATH = 260;
const TH32CS_SNAPPROCESS = 0x00000002;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

let api = null;
let apiFailed = false;

function loadApi() {
  if (api) return api;
  if (apiFailed) return null;
  try {
    const koffi = require('koffi');
    const kernel32 = koffi.load('kernel32.dll');

    const PROCESSENTRY32W = koffi.struct('AW_PROCESSENTRY32W', {
      dwSize: 'uint32',
      cntUsage: 'uint32',
      th32ProcessID: 'uint32',
      th32DefaultHeapID: 'uintptr_t',
      th32ModuleID: 'uint32',
      cntThreads: 'uint32',
      th32ParentProcessID: 'uint32',
      pcPriClassBase: 'int32',
      dwFlags: 'uint32',
      szExeFile: koffi.array('char16', MAX_PATH, 'String'),
    });

    api = {
      koffi,
      entrySize: koffi.sizeof(PROCESSENTRY32W),
      CreateToolhelp32Snapshot: kernel32.func('void* __stdcall CreateToolhelp32Snapshot(uint32 dwFlags, uint32 th32ProcessID)'),
      Process32FirstW: kernel32.func('int __stdcall Process32FirstW(void* hSnapshot, _Inout_ AW_PROCESSENTRY32W* lppe)'),
      Process32NextW: kernel32.func('int __stdcall Process32NextW(void* hSnapshot, _Inout_ AW_PROCESSENTRY32W* lppe)'),
      CloseHandle: kernel32.func('int __stdcall CloseHandle(void* hObject)'),
      OpenProcess: kernel32.func('void* __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func(
        'int __stdcall QueryFullProcessImageNameW(void* hProcess, uint32 dwFlags, _Out_ char16* lpExeName, _Inout_ uint32* lpdwSize)'
      ),
    };
    return api;
  } catch {
    apiFailed = true;
    api = null;
    return null;
  }
}

function isAvailable() {
  return loadApi() !== null;
}

// Reused across polls: the struct is written by the kernel on every Process32NextW call, so a single
// object is enough and keeps the poll allocation-free apart from the returned rows.
function newEntry(size) {
  return {
    dwSize: size,
    cntUsage: 0,
    th32ProcessID: 0,
    th32DefaultHeapID: 0,
    th32ModuleID: 0,
    cntThreads: 0,
    th32ParentProcessID: 0,
    pcPriClassBase: 0,
    dwFlags: 0,
    szExeFile: '',
  };
}

// Snapshot of every process as `{ process, pid }`. `filepath` is deliberately NOT resolved here:
// it needs one OpenProcess per row, and the only caller that wants it (the playtime monitor) wants
// it for newly created processes only - a handful per poll instead of ~460.
function listSync() {
  const win32 = loadApi();
  if (!win32) throw new Error('koffi process snapshot unavailable');

  const handle = win32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  // INVALID_HANDLE_VALUE comes back as a null-ish pointer through koffi.
  if (!handle) throw new Error('CreateToolhelp32Snapshot failed');

  const processes = [];
  try {
    const entry = newEntry(win32.entrySize);
    let ok = win32.Process32FirstW(handle, entry);
    while (ok) {
      const name = entry.szExeFile;
      if (name) processes.push({ process: name, pid: entry.th32ProcessID });
      ok = win32.Process32NextW(handle, entry);
    }
  } finally {
    win32.CloseHandle(handle);
  }
  return processes;
}

// Full image path of a live process, or '' when it exited or is not readable (protected/system
// processes deny even PROCESS_QUERY_LIMITED_INFORMATION). Never throws: an unresolved path is a
// normal outcome the monitor already handles.
function getProcessPath(pid) {
  const win32 = loadApi();
  if (!win32 || !Number.isInteger(pid) || pid <= 0) return '';

  let handle;
  try {
    handle = win32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  } catch {
    return '';
  }
  if (!handle) return '';

  try {
    // 32767 wide chars covers the extended-length path limit.
    const buffer = Buffer.alloc(32768 * 2);
    const size = [32768];
    if (!win32.QueryFullProcessImageNameW(handle, 0, buffer, size)) return '';
    return win32.koffi.decode(buffer, 'char16', -1);
  } catch {
    return '';
  } finally {
    try {
      win32.CloseHandle(handle);
    } catch {}
  }
}

module.exports = { isAvailable, listSync, getProcessPath };
