# Windows virtual audio driver (VB-Cable)

To make the Windows installer auto-install the virtual microphone, drop the
official VB-Cable installer here **before building**:

```
drivers/windows/VBCABLE_Setup_x64.exe
```

Download it from <https://vb-audio.com/Cable/> (the zip contains
`VBCABLE_Setup_x64.exe`).

## What happens at build / install time

- `electron-builder.yml` copies this folder to `resources/drivers/` inside the
  packaged app.
- `build/installer.nsh` runs `VBCABLE_Setup_x64.exe -i -h` silently during
  installation (the installer is already elevated via `perMachine: true`, so no
  second UAC prompt).
- If the exe is **not** present here, the build still succeeds; the driver step
  is skipped and the app falls back to the in-app "Install now" button / guide
  on first run.

## ⚠️ Licensing

VB-Cable is donationware. **Redistributing the installer inside another product
requires a licensing agreement with VB-Audio.** Obtain permission before
shipping a bundled build. See <https://vb-audio.com/Cable/> → licensing.

This folder is intentionally kept empty in source control — the binary is not
committed.
