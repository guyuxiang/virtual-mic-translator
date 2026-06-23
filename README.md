# Virtual Mic Translator

Desktop virtual microphone translator. You speak Chinese → Zoom/Teams/Meet hear the translated language. Built on Electron, reusing the `live-translate` server with **zero server changes**.

```
getUserMedia(mic) → LiveKit publishTrack → server TranslationBridge → Gemini
   translated audio ← LiveKit (translator-<lang>) ← Gemini
   audio.setSinkId(virtual mic) → Zoom/Teams pick it as the microphone
```

## Install

The virtual microphone driver is bundled and installed for you — no manual
download. Neither installer is commercially code-signed (see notes below).

### macOS — one line

No Apple Developer account needed: the app is ad-hoc signed and the installer
strips the Gatekeeper quarantine flag.

```bash
curl -fsSL https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/install.sh | bash
```

Installs the **BlackHole** virtual mic, copies the app to `/Applications`, and
de-quarantines it. Then pick **BlackHole 2ch** as your mic in Zoom/Teams/Meet.

Uninstall:

```bash
curl -fsSL https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/uninstall.sh | bash
```

### Windows — download & run

**[⬇ Download VirtualMicTranslator-Setup.exe](https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/VirtualMicTranslator-Setup.exe)**

Or via PowerShell:

```powershell
$u="https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/VirtualMicTranslator-Setup.exe"; $o="$env:TEMP\VMT-Setup.exe"; iwr $u -OutFile $o; Start-Process $o
```

The installer bundles **VB-Cable**, installs it silently, and restores your
default speaker (so system sound keeps working). Then pick **CABLE Output** as
your mic in Zoom/Teams/Meet.

> If SmartScreen warns ("unknown publisher"), click **More info → Run anyway** —
> the installer is unsigned.

### How releases are built

Both installers are produced automatically on **free GitHub runners** (no Mac or
Windows machine of your own needed). Push a tag to trigger them:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

→ `.github/workflows/release-mac.yml` (macOS universal) and
`release-windows.yml` (NSIS .exe) build and attach their installers to the
GitHub Release for that tag.

## How it connects

- The client talks to the public server at `https://www.openshort.cloud`
  (hardcoded in `src/shared/config.ts` — no configuration needed).
- The virtual audio driver is installed by the installer. For manual dev runs,
  install it yourself:
  - **macOS**: `brew install blackhole-2ch`
  - **Windows**: [VB-Cable](https://vb-audio.com/Cable/)
  - **Linux**: `bash scripts/setup-linux.sh`

## Develop / run

```bash
npm install
npm run build        # tsc (main + preload) + esbuild (renderer bundle)
npm start            # launch Electron
```

On Linux the bundled Electron needs a setuid `chrome-sandbox`:

```bash
sudo chown root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Build installers

```bash
npx electron-builder --mac --win --linux   # output → release/
```

### Windows: bundled virtual-mic auto-install

The Windows installer can install the VB-Cable virtual microphone for you — no
manual download:

1. Put `VBCABLE_Setup_x64.exe` in `drivers/windows/` (see that folder's README;
   redistribution needs a VB-Audio license).
2. Build: `npm run build && npx electron-builder --win`.

What the NSIS installer does (`build/installer.nsh`):
- Runs `VBCABLE_Setup_x64.exe -i -h` silently during install.
- `perMachine: true` elevates the whole installer once, so the driver installs
  with **no second UAC prompt**.

If the driver isn't bundled (or install fails), the app falls back to an
in-app **"Install now"** button on first run, which runs the bundled installer
with elevation (one UAC prompt). A reboot may be required before Windows shows
the device.

> Note: producing the `.exe` from a non-Windows host also needs `wine` and an
> `assets/icon.ico`. The auto-install logic itself is platform-agnostic in the
> repo and only activates on Windows at runtime.

## How it maps to the server (no changes needed)

| Step | Endpoint |
|------|----------|
| Create session | `POST /api/sessions` `{organizerName, password}` |
| Get publish token | `GET /api/token?room=<sessionId>&identity=<id>&role=organizer` |
| Start translation | `POST /api/translate` `{sessionId, targetLanguage}` |
| Token usage | `GET /api/translate/status?sessionId=<id>` |
| End session | `POST /api/sessions/<id>/end` |

The LiveKit websocket URL is taken from the `/api/token` response (`serverUrl`), not hardcoded.

## Project layout

```
src/
├── main/
│   ├── index.ts      # Electron main: window, IPC, permissions
│   ├── tray.ts       # System tray + status
│   └── devices.ts    # Virtual audio driver detection
├── preload.ts        # contextBridge (whitelisted API)
├── shared/config.ts  # Server URLs, languages, audio settings
└── renderer/
    ├── index.html
    ├── style.css
    └── app.ts        # LiveKit + setSinkId pipeline (the core)
```
