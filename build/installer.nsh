; Custom NSIS hooks for Virtual Mic Translator.
;
; Silently installs the bundled VB-Cable virtual-audio driver during app
; installation. Because nsis.perMachine = true, the installer already runs
; elevated, so VB-Cable installs without a second UAC prompt.
;
; VB-Cable silent flags:  -i  install   -h  hidden/silent   -u  uninstall

!macro customInstall
  IfFileExists "$INSTDIR\resources\drivers\VBCABLE_Setup_x64.exe" 0 vbcable_absent
    DetailPrint "Installing VB-Cable virtual microphone driver..."
    ; setup-audio.ps1 records the current default speaker, installs VB-Cable,
    ; then restores the speaker as default (so the user keeps hearing audio).
    IfFileExists "$INSTDIR\resources\drivers\setup-audio.ps1" 0 vbcable_raw
      nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\drivers\setup-audio.ps1" "$INSTDIR\resources\drivers"'
      Pop $0
      DetailPrint "VB-Cable + audio-default restore finished (exit code: $0)."
      Goto vbcable_done
    vbcable_raw:
      ; Fallback: install VB-Cable directly if the helper script is missing.
      nsExec::ExecToLog '"$INSTDIR\resources\drivers\VBCABLE_Setup_x64.exe" -i -h'
      Pop $0
      DetailPrint "VB-Cable installer finished (exit code: $0)."
    Goto vbcable_done
  vbcable_absent:
    DetailPrint "VB-Cable installer not bundled — skipping (app will prompt on first run)."
  vbcable_done:
!macroend

!macro customUnInstall
  IfFileExists "$INSTDIR\resources\drivers\VBCABLE_Setup_x64.exe" 0 vbcable_uninst_skip
    DetailPrint "Removing VB-Cable virtual microphone driver..."
    nsExec::ExecToLog '"$INSTDIR\resources\drivers\VBCABLE_Setup_x64.exe" -u -h'
    Pop $0
  vbcable_uninst_skip:
!macroend
