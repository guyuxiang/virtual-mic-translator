# Virtual Mic Translator — 产品设计文档

> **架构**: Electron 桌面应用 × 现有 live-translate 服务器（零改造）
> **核心洞察**: Chromium `setSinkId` 可以把翻译音频直接路由到虚拟麦克风设备
> **技术栈**: Electron + livekit-client + setSinkId + 虚拟音频驱动
> **日期**: 2026-06-23

---

## 1. 产品定位

**一句话**: 桌面端虚拟翻译麦克风。你说中文 → Zoom/Teams/Meet 听到翻译后的外语。拖盘驻留，开机自启，零感知。

```
┌──────────────────────────────────────────────┐
│  你说:  "大家好，今天讨论供应链金融..."         │
│                                              │
│  Zoom 里 (选了 "Virtual Translator" 当麦克风): │
│  "Hello everyone, today we'll discuss..."     │
└──────────────────────────────────────────────┘
```

| | 当前 live-translate | Virtual Mic Translator |
|---|---|---|
| 运行位置 | 服务器 Docker | **用户桌面** (macOS/Win/Linux) |
| 音频输入 | 浏览器 MediaStream | **Electron getUserMedia** |
| 音频输出 | 浏览器扬声器 | **虚拟麦克风设备** (setSinkId) |
| 翻译引擎 | Gemini Live API (已有) | **同** — 服务器不动 |
| 适用 App | 只有自建 LiveKit 会议 | **任何视频会议软件** |
| Session 管理 | SQLite (已有) | **完全复用** |
| 部署 | Docker | `brew install` 虚拟驱动 + `.dmg` 安装 |

---

## 2. 为什么是 Electron

### 全链路标准 Web API，零桥接

```
┌─ Electron (Chromium) ──────────────────────────────────┐
│                                                         │
│  🎤 getUserMedia({deviceId: 物理麦克风})                 │
│        │                                                │
│        │  MediaStreamTrack                              │
│        ▼                                                │
│  livekit-client.publishTrack()  ────────▶  LiveKit 房间  │
│                                              │          │
│  livekit-client 订阅 translator 音频 ◀───────┘          │
│        │                                                │
│        │  RemoteAudioTrack → MediaStream                │
│        ▼                                                │
│  audioElement.setSinkId('虚拟设备ID')  ──▶  虚拟麦克风    │
│                                              │          │
│                                    Zoom/Teams 选它当麦   │
└─────────────────────────────────────────────────────────┘
```

**四步全走浏览器标准 API**，不需要 Python、不需要 Node.js 桥接进程、不需要 sounddevice/PyAudio。`livekit-client` 是 LiveKit 官方浏览器 SDK，`setSinkId` 是 Chromium 音频路由 API。

### 三框架对比

| | **Electron** | Tauri | 纯 Python |
|---|---|---|---|
| `livekit-client` 浏览器 SDK | ✅ 原生 | ⚠️ WebView 限制 | ❌ 不可用 |
| `setSinkId` 音频路由 | ✅ Chromium 全平台 | ❌ Safari/macOS 不支持 | N/A |
| `getUserMedia` 稳定性 | ✅ 生产级 | ⚠️ 平台差异大 | N/A |
| 调已有 REST API | ✅ `fetch` | ✅ `fetch` | ✅ |
| App 体积 | ~150 MB | ~10 MB | ~50 MB |
| 跨平台打包 | ✅ dmg/exe/AppImage | ✅ | ⚠️ PyInstaller |
| 项目代码量 | ~300 行 JS/TS | ~400 行 Rust+JS | ~600 行 Python |

**Tauri 的死穴**: macOS 用 WebKit（Safari），`setSinkId` 不支持。Windows/Linux 用 WebView2/WebKitGTK，行为不一致。Electron 三个平台都是 Chromium，行为完全一致。

---

## 3. 整体架构

```
┌─ 用户桌面 (Electron App) ───────────────────────────┐
│                                                       │
│  ┌─────────────────────────────────────────────┐     │
│  │          Main Process (Node.js)              │     │
│  │                                             │     │
│  │  • 窗口管理 (BrowserWindow)                  │     │
│  │  • 系统托盘 (Tray)                          │     │
│  │  • 开机自启 (auto-launch)                    │     │
│  │  • 虚拟设备检测 (enumerateDevices)           │     │
│  │  • 首次安装引导弹窗                           │     │
│  │  • 自动更新 (electron-updater)               │     │
│  └────────────────────┬────────────────────────┘     │
│                       │ IPC                           │
│  ┌────────────────────▼────────────────────────┐     │
│  │       Renderer Process (Chromium)            │     │
│  │                                              │     │
│  │  ┌────────────────────────────────────┐      │     │
│  │  │  navigator.mediaDevices            │      │     │
│  │  │    .getUserMedia({audio: ...})     │      │     │
│  │  │         │                          │      │     │
│  │  │         ▼ MediaStreamTrack         │      │     │
│  │  │  room.localParticipant             │      │     │
│  │  │    .publishTrack(micTrack)  ───────┼───┐  │     │
│  │  └────────────────────────────────────┘   │  │     │
│  │                                            │  │     │
│  │  ┌────────────────────────────────────┐   │  │     │
│  │  │  room.on('trackSubscribed', ...)   │   │  │     │
│  │  │         │                          │   │  │     │
│  │  │         ▼ RemoteAudioTrack         │   │  │     │
│  │  │  audio.srcObject = stream          │   │  │     │
│  │  │  audio.setSinkId(virtualDeviceId)  │   │  │     │
│  │  │  audio.play()                      │   │  │     │
│  │  └────────────────────────────────────┘   │  │     │
│  │                                            │  │     │
│  │  ┌────────────────────────────────────┐   │  │     │
│  │  │  UI (HTML/CSS)                     │   │  │     │
│  │  │  • 语言选择 / 麦克风选择              │   │  │     │
│  │  │  • 开始/停止                         │   │  │     │
│  │  │  • 实时字幕                          │   │  │     │
│  │  │  • 连接状态 + token 用量              │   │  │     │
│  │  └────────────────────────────────────┘   │  │     │
│  └───────────────────────────────────────────┘  │     │
│                       │                          │     │
│         LiveKit WebRTC│  HTTP REST (fetch)       │     │
│                       │                          │     │
└───────────────────────┼──────────────────────────┘     │
                        │                                │
                        ▼                                │
┌─ 服务器 (openshort.cloud:3001) ──────────────────────┐ │
│                                                       │ │
│  EXISTING — 不改任何代码:                               │ │
│                                                       │ │
│  ┌─────────────────────┐  ┌─────────────────────────┐ │ │
│  │ LiveKit Server      │  │ Next.js API             │ │ │
│  │ :7880               │  │ :3001                   │ │ │
│  │                     │  │                         │ │ │
│  │ 房间管理             │  │ POST /api/sessions      │ │ │
│  │ WebRTC 中转          │  │ POST /api/translate     │ │ │
│  │                     │  │ GET  /api/token         │ │ │
│  └─────────┬───────────┘  │ GET  /api/sessions      │ │ │
│            │              │ POST /api/sessions/:id   │ │ │
│  ┌─────────▼───────────┐  │   /end                  │ │ │
│  │ TranslationBridge   │  │                         │ │ │
│  │ (已有)               │  │ TranslationSession-     │ │ │
│  │                     │  │ Manager (已有)           │ │ │
│  │ LiveKit bot → Gemini│  │ SQLiteStore (已有)       │ │ │
│  │ WebSocket           │  └─────────────────────────┘ │ │
│  └─────────────────────┘                               │ │
│                                                       │ │
└───────────────────────────────────────────────────────┘ │
```

---

## 4. 关键技术：setSinkId

### 原理

Chromium 允许给 `<audio>` / `<video>` 元素指定音频输出设备：

```javascript
// 枚举所有音频输出设备
const devices = await navigator.mediaDevices.enumerateDevices();
const virtualMic = devices.find(d => 
  d.kind === 'audiooutput' && 
  d.label.includes('BlackHole')  // macOS
  || d.label.includes('CABLE')   // Windows
  || d.label.includes('virtual') // Linux
);

// 把翻译音频路由到虚拟设备
const audio = new Audio();
await audio.setSinkId(virtualMic.deviceId);
audio.srcObject = translatedStream;
audio.play();
```

音频会「流入」虚拟设备。虚拟设备在系统层面被识别为**麦克风输入源**，所以 Zoom/Teams/Meet 可以直接选它。

### 数据流

```
          Chromium 内部
          ┌─────────────────────┐
          │  audio.srcObject    │
          │  = translatedStream │
          │         │           │
          │    setSinkId(       │
          │     'BlackHole 2ch')│
          │         │           │
          └─────────┼───────────┘
                    │ PCM
                    ▼
          ┌─────────────────────┐
          │  BlackHole 驱动      │
          │  (虚拟音频设备)       │
          └─────────┬───────────┘
                    │
          ┌─────────▼───────────┐
          │  macOS Core Audio   │
          │  识别为: 麦克风输入   │
          └─────────┬───────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │  Zoom / Teams       │
          │  选 "BlackHole 2ch" │
          │  作为麦克风          │
          └─────────────────────┘
```

### 兼容性

| 平台 | Chromium 版本要求 | 现状 |
|------|------------------|------|
| macOS | Chrome 110+ | ✅ Electron 内置 Chromium |
| Windows | Chrome 110+ | ✅ |
| Linux | Chrome 110+ | ✅ |

---

## 5. 核心代码

### 渲染进程 — 完整翻译流程 (~120 行)

```typescript
// src/renderer/app.ts

import { Room, RoomEvent, RemoteAudioTrack } from 'livekit-client';

const SERVER = 'https://openshort.cloud';
const SESSION_PASSWORD = 'Aa123456!';

interface AppState {
  room: Room | null;
  targetLanguage: string;
  micDeviceId: string;
  virtualSinkId: string;
}

const state: AppState = {
  room: null,
  targetLanguage: 'en',
  micDeviceId: '',
  virtualSinkId: '',
};

// ============================================================
// 1. 创建 Session + 获取 Token（调已有 API，一字不改）
// ============================================================

async function createSession() {
  const resp = await fetch(`${SERVER}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizerName: 'desktop', password: SESSION_PASSWORD }),
  });
  return resp.json(); // { sessionId, organizerIdentity }
}

async function getToken(identity: string, roomName: string) {
  const resp = await fetch(
    `${SERVER}/api/token?identity=${encodeURIComponent(identity)}&room=${encodeURIComponent(roomName)}`
  );
  const data = await resp.json();
  return data.token;
}

// ============================================================
// 2. LiveKit 房间管理
// ============================================================

async function joinRoom(session: any) {
  const token = await getToken(session.organizerIdentity, session.sessionId);
  
  const room = new Room({ adaptiveStream: true, dynacast: true });
  
  // 订阅翻译音频 → 路由到虚拟麦克风
  room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
    if (participant.identity.startsWith('translator-')) {
      routeToVirtualMic(track as RemoteAudioTrack);
    }
  });
  
  // 接收转录数据（实时字幕）
  room.on(RoomEvent.DataReceived, (payload, participant) => {
    if (participant?.identity.startsWith('translator-')) {
      const data = JSON.parse(new TextDecoder().decode(payload));
      if (data.type === 'transcription') {
        updateTranscript(data.text, data.final, data.language);
      }
    }
  });
  
  await room.connect('wss://openshort.cloud', token);
  state.room = room;
  return room;
}

// ============================================================
// 3. 音频采集 → 推流
// ============================================================

async function startMicCapture() {
  // getUserMedia — Chromium 标准 API
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: state.micDeviceId ? { exact: state.micDeviceId } : undefined,
      echoCancellation: false,  // 关键：关掉回声消除，保留原声
      noiseSuppression: false,  // 关掉降噪，保留完整信号
      autoGainControl: false,
    },
  });
  
  const micTrack = stream.getAudioTracks()[0];
  await state.room!.localParticipant.publishTrack(micTrack, {
    source: TrackSource.SourceMicrophone,
  });
}

// ============================================================
// 4. 启动翻译
// ============================================================

async function startTranslation(sessionId: string) {
  await fetch(`${SERVER}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, targetLanguage: state.targetLanguage }),
  });
}

// ============================================================
// 5. 翻译音频 → 虚拟麦克风 (setSinkId)
// ============================================================

function routeToVirtualMic(track: RemoteAudioTrack) {
  const stream = new MediaStream([track.mediaStreamTrack]);
  
  const audio = new Audio();
  audio.autoplay = true;
  audio.srcObject = stream;
  
  // 关键：路由到虚拟设备
  audio.setSinkId(state.virtualSinkId).then(() => {
    console.log('Audio routed to virtual mic');
  }).catch(err => {
    console.error('setSinkId failed:', err);
    // 弹窗提示用户安装虚拟音频驱动
  });
}

// ============================================================
// 6. 主流程
// ============================================================

async function start() {
  const session = await createSession();
  await joinRoom(session);
  await startMicCapture();
  await startTranslation(session.sessionId);
  
  // 此时: 你说中文 → LiveKit → TranslationBridge → Gemini
  //      → 翻译音频 → setSinkId → 虚拟麦克风 → Zoom 听到英文
  updateStatus('translating');
}

async function stop() {
  if (state.room) {
    await fetch(`${SERVER}/api/sessions/${currentSessionId}/end`, { method: 'POST' });
    await state.room.disconnect();
    state.room = null;
  }
  updateStatus('stopped');
}
```

---

## 6. 虚拟音频设备

### 为什么 setSinkId 是游戏规则改变者

之前所有方案（Python + sounddevice、Python + Node.js 桥接）都需要**显式向设备写 PCM**。setSinkId 让 Chromium 替我们做了这件事——把 `<audio>` 元素的输出路由到指定设备，全自动。

### 三平台方案

| 平台 | 虚拟驱动 | 设备名 | 安装 |
|------|---------|--------|------|
| **macOS** | BlackHole 2ch | `BlackHole 2ch` | `brew install blackhole-2ch` |
| **Windows** | VB-Cable | `CABLE Input` | [下载安装包](https://vb-audio.com/Cable/) |
| **Linux** | PulseAudio null-sink | `virtual_translator` | `bash setup-linux.sh` |

### 首次启动检测

```typescript
// src/main/devices.ts

import { execSync } from 'child_process';

export function detectVirtualDevice(): {
  installed: boolean;
  deviceName: string;
  guide: string;
} {
  switch (process.platform) {
    case 'darwin':
      try {
        execSync('system_profiler SPAudioDataType | grep "BlackHole"');
        return { installed: true, deviceName: 'BlackHole 2ch', guide: '' };
      } catch {
        return {
          installed: false,
          deviceName: 'BlackHole 2ch',
          guide: '在终端运行: brew install blackhole-2ch\n然后重启 App',
        };
      }
    
    case 'win32':
      // 通过 PowerShell 检测 VB-Cable
      try {
        execSync(
          'powershell -Command "Get-AudioDevice -List | Select-String CABLE"'
        );
        return { installed: true, deviceName: 'CABLE Input', guide: '' };
      } catch {
        return {
          installed: false,
          deviceName: 'CABLE Input',
          guide: '请下载安装 VB-Cable:\nhttps://vb-audio.com/Cable/',
        };
      }
    
    case 'linux':
      try {
        execSync('pactl list sinks short | grep virtual_translator');
        return { installed: true, deviceName: 'virtual_translator', guide: '' };
      } catch {
        return {
          installed: false,
          deviceName: 'virtual_translator',
          guide: '在终端运行: bash setup-linux.sh',
        };
      }
    
    default:
      return { installed: false, deviceName: '', guide: '不支持的操作系统' };
  }
}
```

### 首次启动引导 UI

如果未检测到虚拟设备：

```
┌──────────────────────────────────────┐
│  ⚠️  需要安装虚拟音频驱动              │
│                                      │
│  这是让 Zoom 能听到翻译的关键组件。      │
│  一次安装，永久使用。                  │
│                                      │
│  ┌──────────────────────────────┐    │
│  │  brew install blackhole-2ch  │ 📋 │
│  └──────────────────────────────┘    │
│                                      │
│  [ 已安装，重新检测 ]   [ 稍后再说 ]    │
└──────────────────────────────────────┘
```

---

## 7. UI 设计

```
┌─────────────────────────────────────┐
│  🎤 Virtual Mic Translator    — □ ✕ │
│─────────────────────────────────────│
│                                     │
│  麦克风  [MacBook Pro 麦克风     ▼]  │
│  翻译为  [English (en)          ▼]  │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ● 翻译中 · 服务器已连接      │    │
│  │  📊 1,234 tokens · $0.0014  │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 实时字幕                     │    │
│  │                             │    │
│  │ Hello everyone, today we'll  │    │
│  │ discuss supply chain         │    │
│  │ finance solutions.           │    │
│  │                             │    │
│  │ Our key challenge is...     │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 请在 Zoom 中选择              │    │
│  │ "BlackHole 2ch" 作为麦克风    │    │
│  └─────────────────────────────┘    │
│                                     │
│         [ ▶ 开始翻译 ]              │
└─────────────────────────────────────┘
```

**尺寸**: 420 × 520 px，支持窗口置顶，可最小化到系统托盘。

### 系统托盘

```
┌──────────────┐
│ ● 翻译中...   │
│ 中文 → 英文   │
│──────────────│
│ 显示窗口      │
│ 停止翻译      │
│──────────────│
│ 退出          │
└──────────────┘
```

---

## 8. 项目结构

```
~/virtual-mic-translator/
├── package.json
├── tsconfig.json
├── electron-builder.yml       # 打包配置
├── src/
│   ├── main/
│   │   ├── index.ts           # Electron 主进程入口
│   │   ├── tray.ts            # 系统托盘
│   │   └── devices.ts         # 虚拟设备检测
│   ├── renderer/
│   │   ├── index.html         # UI
│   │   ├── app.ts             # LiveKit + 音频核心逻辑
│   │   └── style.css
│   └── preload.ts             # contextBridge (暴露安全 API)
├── scripts/
│   ├── setup-macos.sh
│   ├── setup-linux.sh
│   └── setup-windows.ps1
├── assets/
│   ├── icon.png
│   └── icon.icns
└── DESIGN.md
```

---

## 9. 配置

```typescript
// src/shared/config.ts
export const CONFIG = {
  server: {
    baseUrl: 'https://openshort.cloud',
    livekitUrl: 'wss://openshort.cloud',
  },
  session: {
    password: 'Aa123456!',    // 与服务器 SESSION_PASSWORD 一致
    organizerName: 'desktop',
  },
  languages: [
    { code: 'en',  label: 'English' },
    { code: 'ja',  label: '日本語' },
    { code: 'es',  label: 'Español' },
    { code: 'fr',  label: 'Français' },
    { code: 'de',  label: 'Deutsch' },
    { code: 'ko',  label: '한국어' },
    { code: 'zh',  label: '中文' },
  ],
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};
```

**GEMINI_API_KEY 只存在服务器 `.env`**，桌面 App 永远不接触。

---

## 10. 延迟分析

```
你说完一句话 ──────────────────────────▶ Zoom 里听到翻译
│                                          │
├─ mic 缓冲: ~200ms ─┤                     │
│                    ├─ LiveKit WebRTC: ~30ms
│                    │                     │
│                    ├─ Gemini 推理: ~500ms │
│                    │                     │
│                    ├─ LiveKit WebRTC: ~30ms
│                    │                     │
│                    ├─ setSinkId 路由: <5ms
│                    │                     │
│                    ├─ 虚拟驱动: ~10ms ────┤
│                                          │
│◄────────── 总延迟: ~0.8 ~ 1.0 秒 ──────▶│
```

与之前方案一致，LiveKit WebRTC 的 60ms RTT 是额外开销（vs 直接 WebSocket），但换来了**零服务器改造**和**完整 session 管理**。

---

## 11. 安全

| 项 | 方案 | 现状 |
|----|------|------|
| API Key 保护 | 只在服务器，客户端不接触 | ✅ 已有 |
| Session 认证 | 密码 (`SESSION_PASSWORD`) | ✅ 已有 |
| WebRTC 加密 | DTLS-SRTP (LiveKit 内置) | ✅ 已有 |
| IPC 安全 | `contextBridge` 白名单 API | ✅ Electron 推荐 |
| 自动更新签名 | electron-builder 代码签名 | ⚠️ 需配置 |

---

## 12. 打包分发

```yaml
# electron-builder.yml
appId: com.openshort.virtual-mic-translator
productName: Virtual Mic Translator
copyright: Copyright © 2026

files:
  - dist/**/*
  - assets/**/*

mac:
  category: public.app-category.utilities
  target:
    - dmg
    - zip
  icon: assets/icon.icns

win:
  target:
    - nsis
  icon: assets/icon.ico

linux:
  target:
    - AppImage
    - deb
  category: Utility
  icon: assets/icon.png

nsis:
  oneClick: true
  perMachine: false
  createDesktopShortcut: true
```

```bash
# 一条命令出三平台包
npm run build
npx electron-builder --mac --win --linux
```

---

## 13. 开发路线图

### Phase 1 — MVP (~3 天)

| 任务 | 时间 | 产出 |
|------|------|------|
| Electron 项目脚手架 | 1h | package.json + tsconfig + main/renderer 骨架 |
| LiveKit 集成 (app.ts) | 3h | 完整翻译流程 |
| 虚拟设备检测 + 引导 | 2h | devices.ts + 安装引导 UI |
| UI 界面 | 3h | 语言选择 + 字幕 + 状态 |
| 系统托盘 | 1h | 后台驻留 |
| 端到端测试 (macOS) | 2h | 可用版本 |

### Phase 2 — 打磨 (~2 天)

- Windows + Linux 测试
- 自动更新 (electron-updater)
- 开机自启
- 字幕滚动优化
- 用量统计（从 TranslationBridge 获取）
- 错误处理 + 重连

### Phase 3 — 进阶 (按需)

- 多语言同时输出（多个虚拟设备）
- 本地 fallback（服务器挂了直连 Gemini）
- 录音功能
- 自定义术语表

---

## 14. 构建启示

1. **Electron 是这个产品的最优解**: `livekit-client` + `setSinkId` 让全链路走标准 Web API，三个平台行为完全一致。Tauri 的 WebKit 限制在 macOS 上直接毙掉 `setSinkId`
2. **零服务器改造是核心竞争力**: 复用已有的 `TranslationBridge` · `SessionManager` · `SQLiteStore` · 所有 HTTP API。新项目只写客户端
3. **`echoCancellation: false` 是关键**: 关掉 Chromium 的音频处理管线，保留原始语音信号给 Gemini
4. **虚拟设备安装是唯一的一次性门槛**: 首次启动引导要做得足够友好（一键复制命令 + 流程截图），这是用户流失的唯一风险点
5. **系统托盘比窗口重要**: 这个 App 大部分时间在后台跑，用户只需要开机后点一下「开始翻译」，然后最小化。托盘菜单 + 状态图标优先级高于主窗口
6. **不要加太多功能**: 语言选择 + 字幕 + 开始/停止 + 托盘。其他都是噪音
