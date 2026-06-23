# Virtual Mic Translator — 设计与实现文档（As-Built）

> **架构**: Electron 桌面应用 × 现有 live-translate 服务器（零改造）
> **核心洞察**: Chromium `setSinkId` 把翻译音频直接路由到虚拟麦克风设备
> **技术栈**: Electron 33 + livekit-client + setSinkId + 虚拟音频驱动（BlackHole / VB-Cable）
> **状态**: 已实现并发布 —— macOS(通用) + Windows，经 GitHub Actions 自动构建
> **仓库**: https://github.com/guyuxiang/virtual-mic-translator
> **更新**: 2026-06-23

---

## 0. 实现现状（As-Built）

| 项 | 现状 |
|---|---|
| 平台 | ✅ macOS（通用二进制，Intel + Apple 芯片）、✅ Windows（x64） |
| 发布 | GitHub Releases，`vX.Y.Z` tag 触发两条 GitHub Actions 工作流自动构建上传 |
| 构建机 | GitHub 免费 `macos-latest` / `windows-latest` runner，**无需自有 Mac/Windows** |
| 代码签名 | 无 Apple 开发者账号 —— 走 ad-hoc 签名 + 终端去隔离 |
| 虚拟驱动 | 安装包/脚本自动安装（mac: BlackHole 2ch，win: VB-Cable） |
| 服务器 | `https://www.openshort.cloud`（公网域名，已硬编码，客户端无需配置） |
| UI | Anthropic / Claude 风格（Inter + Fraunces 字体、珊瑚橙配色、自绘图标） |

**安装命令**

```bash
# macOS（一行）
curl -fsSL https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/install.sh | bash

# Windows（下载运行）
https://github.com/guyuxiang/virtual-mic-translator/releases/latest/download/VirtualMicTranslator-Setup.exe
```

---

## 1. 产品定位

**一句话**: 桌面端虚拟翻译麦克风。你说中文 → Zoom/Teams/Meet 听到翻译后的外语。

```
┌──────────────────────────────────────────────┐
│  你说:  "大家好，今天讨论供应链金融..."          │
│                                              │
│  会议软件里 (麦克风选了虚拟设备):                │
│  "Hello everyone, today we'll discuss..."     │
└──────────────────────────────────────────────┘
```

复用现有 live-translate 服务器的 `TranslationBridge` · `SessionManager` · `SQLiteStore` · 全部 HTTP API，**服务器一行不改**，只写客户端。

---

## 2. 技术选型

核心需求只有两条硬约束，谁能稳定满足谁就能用：

1. **`setSinkId`** —— 把翻译音频路由到虚拟输出设备（**Chromium 专有 Web API**）
2. **`livekit-client` / WebRTC** —— 连 LiveKit 收发音频

| 方案 | setSinkId | 体积 | 工作量 | 结论 |
|---|---|---|---|---|
| **Electron**（选用） | ✅ 全平台 Chromium 一致 | ~180MB | 已完成 | 一套代码、三端行为一致 |
| Tauri / Wails | ❌ macOS 是 WebKit，不支持 | ~10MB | 中 | **macOS 上死在核心功能** |
| Flutter + LiveKit SDK | ⚠️ 插件路由到虚拟设备不成熟 | ~40MB | 大 | 风险高 |
| 原生 Swift + C# + LiveKit 原生 SDK | 改用 CoreAudio/WASAPI 直写 | 最小 | 最大（两套代码） | 仅在有体积/性能 KPI 时考虑 |
| **纯网页**（Chrome 内打开） | ✅ Chrome 原生 | 0 安装 | 最小 | 备选：零安装，但无托盘/无法自动装驱动/需常开标签页 |

**实战结论**

- **Tauri 的死穴是真的**：macOS 用 WKWebView，`setSinkId` 不支持；为 macOS 单独写原生音频就失去了 Tauri 的意义。
- Electron 相比「纯网页」多出来的价值仅三样：**自动装虚拟驱动、系统托盘、原生 App 体验**。轻量场景可考虑网页版并存。
- **macOS 麦克风权限反复弹窗是代码签名问题，与框架无关**——任何未签名 App（含原生）都会遇到，根治靠正式签名。

---

## 3. 整体架构

```
┌─ 用户桌面 (Electron App) ─────────────────────────────┐
│  Main (Node.js)                Renderer (Chromium)    │
│  • BrowserWindow / Tray        • getUserMedia(mic)     │
│  • 虚拟设备检测                  • livekit publishTrack   │
│  • 一键装驱动(win)              • 订阅 translator-<lang>  │
│  • IPC (contextBridge)         • audio.setSinkId(虚拟) │
└───────────────────┬───────────────────────────────────┘
        LiveKit WebRTC │  HTTP REST (fetch)
                       ▼
┌─ 服务器 https://www.openshort.cloud（不改一行）────────┐
│  LiveKit (wss://…/livekit)   Next.js API              │
│  TranslationBridge → Gemini  /api/sessions /token …   │
└───────────────────────────────────────────────────────┘
```

---

## 4. 服务器契约（实际 API）

> 全部为现有 live-translate 服务器的既有接口，客户端按真实契约对接。

| 步骤 | 接口 | 关键点 |
|---|---|---|
| 建会话 | `POST /api/sessions` `{organizerName, password}` | 返回 `{sessionId, organizerIdentity, joinUrl, broadcastUrl}` |
| 取 token | `GET /api/token?room={sessionId}&identity={organizerIdentity}&role=organizer` | **必须带 `role=organizer`** 才有 `canPublish`；返回 `{token, serverUrl}` |
| 起翻译 | `POST /api/translate` `{sessionId, targetLanguage}` | 返回 `{translatorIdentity, status, targetLanguage}` |
| 用量 | `GET /api/translate/status?sessionId=` | `translations[].inputTokens/outputTokens` |
| 结束 | `POST /api/sessions/{id}/end` | 释放 bridge + 结束 SQLite 会话 |

**LiveKit 房间名 = `sessionId`**。翻译 bot 身份 = `translator-{lang}`。转录数据通过 reliable data channel（topic `transcription`）下发：

```json
{ "type": "transcription", "language": "en", "segmentId": "en-3", "text": "...", "final": true, "timestamp": 0 }
```

> **LiveKit 的 WebSocket 地址不硬编码**——取自 `/api/token` 返回的 `serverUrl`（当前 `wss://www.openshort.cloud/livekit`）。

---

## 5. 关键技术：setSinkId

Chromium 允许给 `<audio>` 指定输出设备：把翻译音频「流入」虚拟设备，虚拟设备在系统层被识别为**麦克风输入源**，会议软件直接选它。

```
audio.srcObject = translatedStream
audio.setSinkId('BlackHole 2ch' / 'CABLE Input')   ──▶ 虚拟驱动
                                                    ──▶ 系统识别为麦克风
                                                    ──▶ Zoom/Teams 选它
```

兼容性：mac/win/linux 的 Electron 内置 Chromium 均支持（Chrome 110+）。

---

## 6. 核心代码要点（src/renderer/app.ts）

```typescript
const SERVER = 'https://www.openshort.cloud';   // src/shared/config.ts

// 1) 建会话 + 取可发布 token（role=organizer 是关键）
const { sessionId, organizerIdentity } = await createSession();
const { token, serverUrl } = await getToken(organizerIdentity, sessionId); // ?role=organizer

// 2) 连房间，订阅 translator-<lang> 音频 → 路由到虚拟麦
const room = new Room({ adaptiveStream: true, dynacast: true });
room.on(RoomEvent.TrackSubscribed, (track, _p, participant) => {
  if (track.kind === Track.Kind.Audio && participant.identity.startsWith('translator-'))
    routeToVirtualMic(track);                    // audio.setSinkId(virtualSinkId)
});
room.on(RoomEvent.DataReceived, /* transcription → 字幕 */);
await room.connect(serverUrl, token);

// 3) 采集麦克风（关掉所有音频处理，保留原声给 Gemini）→ 推流
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { deviceId, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
await room.localParticipant.publishTrack(stream.getAudioTracks()[0], { source: Track.Source.Microphone });

// 4) 起翻译
await startTranslation(sessionId, targetLanguage);
```

**macOS 麦克风权限要点（踩坑后修正）**：`getUserMedia` 探测设备**只做一次**（解锁设备 label），`devicechange` 事件里**只枚举、绝不再调 getUserMedia**——否则在 macOS 上「开流→停流」会再触发 `devicechange`，造成权限弹窗死循环。

---

## 7. 虚拟音频设备

| 平台 | 驱动 | 设备名 | App 路由到 (输出) | 会议软件选 (输入) |
|---|---|---|---|---|
| **macOS** | BlackHole 2ch | `BlackHole 2ch` | BlackHole 2ch | **BlackHole 2ch**（同名双向） |
| **Windows** | VB-Cable | `CABLE Input/Output` | CABLE Input | **CABLE Output** |
| **Linux** | PulseAudio null-sink | `virtual_translator` | virtual_translator | Translate_Mic |

**两个易混点**：
- 装完虚拟驱动后系统里会**多出成对的输入/输出设备**（如 `CABLE Input` + `CABLE Output`），这是虚拟线缆的两端，正常且必需。
- macOS 上**新装的音频驱动需重载 Core Audio 才出现**（`sudo killall coreaudiod`，或重启）——否则 `system_profiler` 和会议软件都看不到。安装脚本已自动重载。

---

## 8. UI 设计（Claude 风格）

- **配色**：暖象牙白背景 `#F0EEE6`、Claude 珊瑚橙主色 `#D97757`、暖近黑文字 `#1F1E1D`。
- **字体（已内嵌 woff2，离线可用）**：标题 **Fraunces**（衬线），正文 **Inter**。
- **图标**：珊瑚渐变圆角方块 +「文 / A」双语气泡，已生成 `.icns/.ico/.png`。
- **窗口**：560×640，关闭即**直接退出**（不最小化到托盘）；托盘仅在运行时提供状态与开始/停止。
- 主界面：麦克风选择 + 目标语言 + 开始/停止 + 实时字幕 + token 用量 + 虚拟麦提示。
- 未检测到虚拟驱动时显示引导卡片；Windows 提供「Install now」一键装驱动按钮。

---

## 9. 配置（src/shared/config.ts）

```typescript
export const CONFIG = {
  server: { baseUrl: 'https://www.openshort.cloud', /* token/sessions/translate endpoints */ },
  session: { organizerName: 'desktop' },   // 密码不入代码：登录时输入，服务器校验
  languages: [ /* en ja es fr de ko zh pt ru ar */ ],
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};
```

---

## 10. 打包与分发（GitHub Actions）

两条工作流，`vX.Y.Z` tag 同时触发，产物上传同一个 Release：

| 工作流 | runner | 产物 |
|---|---|---|
| `.github/workflows/release-mac.yml` | `macos-latest` | `VirtualMicTranslator-mac.zip`（通用，ad-hoc 签名）+ `BlackHole.pkg` + `install.sh` + `uninstall.sh` |
| `.github/workflows/release-windows.yml` | `windows-latest` | `VirtualMicTranslator-Setup.exe`（NSIS，内置 VB-Cable） |

构建：`tsc`(main+preload) + `esbuild`(renderer 打包，含 livekit-client) → `electron-builder`。

**CI 注意**（都已固化在工作流里）：
- Node 22；安装设 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`（electron-builder 打包时自行下载 electron）。
- 第三方驱动二进制（VB-Cable、SoundVolumeView）**不进仓库**，由 Windows 工作流在 CI 现下载。

---

## 11. macOS 安装与签名细节（无开发者账号）

`install.sh` 流程：

1. 下载 `VirtualMicTranslator-mac.zip`，`ditto -x -k` 解包。
2. 装 BlackHole：有 Homebrew → `brew install blackhole-2ch`；否则下 `BlackHole.pkg` → `sudo installer`。
3. **`sudo killall coreaudiod`** 重载音频服务，免重启即可出现 BlackHole。
4. 拷到 `/Applications`，`xattr -dr com.apple.quarantine` 去隔离（消除 Gatekeeper「无法验证开发者」）。
5. **`codesign --force --deep --sign -`** 深度 ad-hoc 重签名 → 给 App 及所有 Electron Helper 一个稳定身份，**让 macOS TCC 记住麦克风授权**（否则未签名 Helper 每次启动身份变化，反复弹窗）。
6. `tccutil reset Microphone com.openshort.virtual-mic-translator` 清理旧状态，保证下次只问一次。

`electron-builder.yml` mac：`identity: null`、`hardenedRuntime` 不开、`extendInfo.NSMicrophoneUsageDescription` 显式声明用途、`artifactName: VirtualMicTranslator-mac.${ext}`。

---

## 12. Windows 安装细节

NSIS `oneClick + perMachine`（整体提权一次，无二次 UAC）。`build/installer.nsh` 在安装时调用 `drivers/windows/setup-audio.ps1`：

1. **先记录**当前默认播放设备（SoundVolumeView 导出 CSV，取默认 Render 设备的 friendly id）。
2. 静默安装 VB-Cable（`VBCABLE_Setup_x64.exe -i -h`）。
3. **还原**默认播放设备 —— 否则 VB-Cable 会把 `CABLE Input` 设成默认输出，导致用户**听不到扬声器**。

会议软件里麦克风选 **CABLE Output**；App 内部自动路由到 **CABLE Input**。未签名，SmartScreen 提示时「更多信息 → 仍要运行」。

---

## 13. 延迟分析

```
说完一句 ──▶ 会议里听到翻译
mic 缓冲 ~200ms │ LiveKit ~30ms │ Gemini ~500ms │ LiveKit ~30ms │ setSinkId <5ms │ 驱动 ~10ms
总延迟 ≈ 0.8 ~ 1.0 秒
```

---

## 14. 安全

| 项 | 现状 |
|---|---|
| API Key | ✅ 仅在服务器，客户端不接触 |
| WebRTC 加密 | ✅ DTLS-SRTP（LiveKit 内置） |
| IPC | ✅ `contextBridge` 白名单 |
| **Session 密码 / 登录** | ✅ 密码**不再硬编码进代码**。打开 App 先弹登录框，用户输入密码 → 调 `POST /api/sessions` 由**服务器校验**（错误返回 401）→ 正确则仅存内存、供后续建会话用。注：客户端密码本质仍属共享口令；更强的方案需服务器侧一次性 token / 设备绑定。 |
| 代码签名 | ⚠️ 未做正式签名（ad-hoc）。如需消除安装告警 → Apple Developer ID（mac）/ 代码签名证书（win）。 |

---

## 15. 开发路线图

- **Phase 1 — MVP**：✅ 完成（翻译全链路、虚拟设备检测、UI、托盘）
- **Phase 2 — 打磨**：✅ macOS + Windows 发布管线、一键安装、驱动自动安装、Claude UI、图标；✅ 麦克风权限/默认设备/Core Audio 等真机问题修复
- **Phase 3 — 进阶（按需）**：自动更新(electron-updater)、纯网页版并存、正式代码签名、多语言同时输出、本地 fallback

---

## 16. 构建踩坑与启示（实战沉淀）

1. **`role=organizer` 不可省**：token 只给 organizer `canPublish`，否则推麦克风被静默拒绝。
2. **`echoCancellation:false`**：关掉 Chromium 音频处理管线，保留原声给 Gemini。
3. **macOS 麦克风反复弹窗 = 两个独立问题**：(a) 代码里 `devicechange` 回调重复调 `getUserMedia` 形成死循环 → 改为只探测一次；(b) 未签名 Helper 身份不稳定 → 深度 ad-hoc 重签名让 TCC 记住授权。
4. **macOS 新音频驱动需重载 Core Audio**（`killall coreaudiod`）才出现，否则误以为「没装上」。
5. **Windows 装 VB-Cable 会抢默认播放设备** → 用 SoundVolumeView 记录并还原，避免用户听不到声音。
6. **CI 的 npm「Exit handler never called!」是假象**：真因是 `package-lock.json` 锁了腾讯云镜像 `mirrors.tencentyun.com`，GitHub runner 访问不了。**在本机改依赖后，提交前务必 `npm install --package-lock-only --registry https://registry.npmjs.org/` 重新生成 lockfile**。
7. **GitHub Actions = 免费 Mac/Win 构建机**：无需自有设备即可出双平台安装包；ad-hoc 签名 + 终端去隔离，免 Apple 开发者账号也能分发。
8. **不要过度堆功能**：语言选择 + 字幕 + 开始/停止 + 托盘，其余都是噪音。
```
