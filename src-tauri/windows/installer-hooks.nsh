; Before the installer writes its files, the Node processes that still run from this install folder are
; ended. The Mirror host, the learning host and the Pi invocations all run mirror-host\node\node.exe, and
; an update can start while one of them has not left yet. The installer then stops at "Error opening file
; for writing" in its default mode, or leaves the old node.exe in place without a word in the silent one.
;
; Only this folder's Node is matched, by its full path, so any other Node on the machine is left alone.
; The path is read through CIM: the installer is a 32-bit process, and a 32-bit PowerShell cannot read the
; path of a 64-bit process through Get-Process, which would match nothing and say nothing.
; The install folder travels in an environment variable, so no character of it is read as script.
; PowerShell is started by its full path in the system folder, and the wait for it is bounded.
!macro NSIS_HOOK_PREINSTALL
  System::Call `kernel32::SetEnvironmentVariable(t "NAUTILUS_INSTALL_DIR", t "$INSTDIR")`
  nsExec::Exec /TIMEOUT=60000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$node = Join-Path $$env:NAUTILUS_INSTALL_DIR 'mirror-host\node\node.exe'; $$own = @(Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' | Where-Object { $$_.ExecutablePath -eq $$node }); foreach ($$process in $$own) { Stop-Process -Id $$process.ProcessId -Force -ErrorAction SilentlyContinue }; foreach ($$process in $$own) { Wait-Process -Id $$process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }"`
  Pop $0
!macroend
