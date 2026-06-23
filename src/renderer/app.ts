/**
 * Renderer — the full translation pipeline.
 *
 *   getUserMedia(mic) ──▶ LiveKit publishTrack ──▶ server TranslationBridge ──▶ Gemini
 *        translated audio ◀── LiveKit TrackSubscribed ◀── translator-{lang}
 *        audio.setSinkId(virtualMic) ──▶ Zoom/Teams hears the translation
 */

import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  type RemoteTrack,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from 'livekit-client';
import { CONFIG } from '../shared/config';

// ── Bridged main-process API (from preload) ───────────────────────
interface VirtualDeviceInfo {
  installed: boolean;
  deviceName: string;
  guide: string;
}
interface DriverInstallResult {
  ok: boolean;
  reason?: 'unsupported' | 'missing-bundle' | 'launch-failed' | 'install-failed';
  message?: string;
  rebootRecommended?: boolean;
}
interface ElectronAPI {
  platform: string;
  detectVirtualDevice(): Promise<VirtualDeviceInfo>;
  canInstallDriver(): Promise<boolean>;
  installVirtualDriver(): Promise<DriverInstallResult>;
  openExternal(url: string): Promise<void>;
  setAlwaysOnTop(onTop: boolean): Promise<void>;
  updateStatus(s: { translating: boolean; from?: string; to?: string }): void;
  onTrayAction(cb: (action: 'start' | 'stop') => void): void;
}
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
const electronAPI = window.electronAPI;

// ── State ─────────────────────────────────────────────────────────
interface AppState {
  room: Room | null;
  sessionId: string | null;
  targetLanguage: string;
  micDeviceId: string;
  virtualSinkId: string;
  virtualDeviceName: string;
  audioEl: HTMLAudioElement | null;
  running: boolean;
  statsTimer: number | null;
}
const state: AppState = {
  room: null,
  sessionId: null,
  targetLanguage: 'en',
  micDeviceId: '',
  virtualSinkId: '',
  virtualDeviceName: '',
  audioEl: null,
  running: false,
  statsTimer: null,
};

// ── DOM helpers ───────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const micSelect = $('mic-select') as HTMLSelectElement;
const langSelect = $('lang-select') as HTMLSelectElement;
const statusDot = $('status-dot');
const statusText = $('status-text');
const statsEl = $('stats');
const transcriptEl = $('transcript');
const setupGuide = $('setup-guide');
const setupInstructions = $('setup-instructions') as HTMLPreElement;
const micHint = $('mic-hint');
const virtualDeviceNameEl = $('virtual-device-name');
const actionBtn = $('action-btn') as HTMLButtonElement;
const setupInstallBtn = $('setup-install') as HTMLButtonElement;

// ── Server API (real live-translate contract) ─────────────────────
const api = CONFIG.server;
const url = (p: string) => `${api.baseUrl}${p}`;

async function createSession(): Promise<{ sessionId: string; organizerIdentity: string }> {
  const resp = await fetch(url(api.sessionsEndpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizerName: CONFIG.session.organizerName,
      password: CONFIG.session.password,
    }),
  });
  if (!resp.ok) throw new Error(`Create session failed (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

// role=organizer is REQUIRED — only organizers get canPublish in the token.
async function getToken(identity: string, room: string): Promise<{ token: string; serverUrl: string }> {
  const resp = await fetch(
    url(`${api.tokenEndpoint}?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(identity)}&role=organizer`)
  );
  if (!resp.ok) throw new Error(`Token request failed (${resp.status})`);
  return resp.json();
}

async function startTranslation(sessionId: string, targetLanguage: string): Promise<void> {
  const resp = await fetch(url(api.translateEndpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, targetLanguage }),
  });
  if (!resp.ok) throw new Error(`Start translation failed (${resp.status}): ${await resp.text()}`);
}

async function endSession(sessionId: string): Promise<void> {
  await fetch(url(`${api.sessionsEndpoint}/${sessionId}/end`), { method: 'POST' }).catch(() => {});
}

async function fetchTokenUsage(sessionId: string): Promise<number> {
  try {
    const resp = await fetch(url(`${api.translateEndpoint}/status?sessionId=${sessionId}`));
    if (!resp.ok) return 0;
    const { translations } = await resp.json();
    let total = 0;
    for (const t of translations ?? []) total += (t.inputTokens ?? 0) + (t.outputTokens ?? 0);
    return total;
  } catch {
    return 0;
  }
}

// ── Devices ───────────────────────────────────────────────────────
// Labels are only populated after mic permission is granted, so we unlock
// them with a throwaway getUserMedia first.
async function refreshDevices(): Promise<void> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
  } catch (e) {
    console.warn('mic probe failed (labels may be hidden):', e);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  // Mic dropdown.
  const mics = devices.filter((d) => d.kind === 'audioinput');
  micSelect.innerHTML = '';
  for (const d of mics) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone ${micSelect.length + 1}`;
    micSelect.appendChild(opt);
  }
  if (mics.length) state.micDeviceId = micSelect.value = mics[0].deviceId;

  // Resolve the virtual audio output sink to route translated audio into.
  resolveVirtualSink(devices);
}

function resolveVirtualSink(devices: MediaDeviceInfo[]): void {
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const needles = [
    state.virtualDeviceName.toLowerCase(),
    'blackhole',
    'cable input',
    'virtual_translator',
    'virtual translator',
  ].filter(Boolean);

  const match = outputs.find((d) => {
    const label = d.label.toLowerCase();
    return needles.some((n) => label.includes(n));
  });

  if (match) {
    state.virtualSinkId = match.deviceId;
    setupGuide.classList.add('hidden');
    micHint.classList.remove('hidden');
  } else {
    state.virtualSinkId = '';
  }
}

async function checkVirtualDevice(): Promise<void> {
  const info = await electronAPI.detectVirtualDevice();
  state.virtualDeviceName = info.deviceName;
  virtualDeviceNameEl.textContent = info.deviceName || 'a virtual audio device';

  await refreshDevices();

  // Show the setup guide if neither the driver nor an output sink was found.
  if (!info.installed && !state.virtualSinkId) {
    setupInstructions.textContent = info.guide;
    setupGuide.classList.remove('hidden');
    micHint.classList.add('hidden');

    // Offer one-click install when a bundled installer is available (Windows).
    const canInstall = await electronAPI.canInstallDriver();
    setupInstallBtn.classList.toggle('hidden', !canInstall);
  } else {
    setupInstallBtn.classList.add('hidden');
  }
}

async function installDriver(): Promise<void> {
  setupInstallBtn.disabled = true;
  const original = setupInstallBtn.textContent;
  setupInstallBtn.textContent = 'Installing… (approve the prompt)';
  try {
    const result = await electronAPI.installVirtualDriver();
    if (result.ok) {
      setupInstructions.textContent = result.rebootRecommended
        ? 'Driver installed. A reboot may be needed before the device appears.\nThen click Re-detect.'
        : 'Driver installed. Click Re-detect.';
      await checkVirtualDevice();
    } else {
      setupInstructions.textContent = `Install failed: ${result.message ?? result.reason}`;
    }
  } catch (err) {
    setupInstructions.textContent = `Install error: ${(err as Error).message}`;
  } finally {
    setupInstallBtn.disabled = false;
    setupInstallBtn.textContent = original;
  }
}

// ── LiveKit room ──────────────────────────────────────────────────
async function joinRoom(sessionId: string, organizerIdentity: string): Promise<Room> {
  const { token, serverUrl } = await getToken(organizerIdentity, sessionId);

  const room = new Room({ adaptiveStream: true, dynacast: true });

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (track.kind === Track.Kind.Audio && participant.identity.startsWith('translator-')) {
      routeToVirtualMic(track);
    }
  });

  room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
    if (!participant?.identity.startsWith('translator-')) return;
    try {
      const data = JSON.parse(new TextDecoder().decode(payload));
      if (data.type === 'transcription') {
        updateTranscript(data.segmentId, data.text, data.final);
      }
    } catch {
      /* ignore non-JSON data */
    }
  });

  room.on(RoomEvent.ConnectionStateChanged, (cs: ConnectionState) => {
    if (cs === ConnectionState.Reconnecting) setStatus('reconnecting', 'Reconnecting…');
    if (cs === ConnectionState.Connected && state.running) setStatus('live', 'Translating · server connected');
  });

  room.on(RoomEvent.Disconnected, () => {
    if (state.running) stop();
  });

  await room.connect(serverUrl, token);
  return room;
}

// ── Mic capture → publish ─────────────────────────────────────────
async function startMicCapture(room: Room): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: state.micDeviceId ? { exact: state.micDeviceId } : undefined,
      echoCancellation: CONFIG.audio.echoCancellation,
      noiseSuppression: CONFIG.audio.noiseSuppression,
      autoGainControl: CONFIG.audio.autoGainControl,
    },
  });
  const micTrack = stream.getAudioTracks()[0];
  await room.localParticipant.publishTrack(micTrack, { source: Track.Source.Microphone });
}

// ── Translated audio → virtual mic (setSinkId) ────────────────────
async function routeToVirtualMic(track: RemoteTrack): Promise<void> {
  const mediaStream = new MediaStream([track.mediaStreamTrack]);

  // Reuse a single <audio> element so re-subscribes don't stack up.
  if (!state.audioEl) {
    state.audioEl = new Audio();
    state.audioEl.autoplay = true;
  }
  const audio = state.audioEl;
  audio.srcObject = mediaStream;

  try {
    if (state.virtualSinkId && typeof (audio as any).setSinkId === 'function') {
      await (audio as any).setSinkId(state.virtualSinkId);
      console.log('Translated audio routed to virtual mic:', state.virtualDeviceName);
    } else {
      console.warn('No virtual sink — translated audio plays on default output.');
    }
    await audio.play();
  } catch (err) {
    console.error('setSinkId/play failed:', err);
    setupInstructions.textContent =
      `Could not route audio to the virtual device.\n${(err as Error).message}`;
    setupGuide.classList.remove('hidden');
  }
}

// ── Transcript rendering ──────────────────────────────────────────
const segments = new Map<string, { text: string; final: boolean }>();

function updateTranscript(segmentId: string, text: string, final: boolean): void {
  if (!segmentId) segmentId = `seg-${segments.size}`;
  segments.set(segmentId, { text, final });
  renderTranscript();
}

function segOrder(id: string): number {
  const n = Number(id.split('-').pop());
  return Number.isFinite(n) ? n : 0;
}

function renderTranscript(): void {
  const ordered = [...segments.entries()].sort((a, b) => segOrder(a[0]) - segOrder(b[0]));
  transcriptEl.innerHTML = '';
  for (const [, seg] of ordered) {
    if (!seg.text.trim()) continue;
    const p = document.createElement('p');
    p.textContent = seg.text;
    p.className = seg.final ? 'seg-final' : 'seg-interim';
    transcriptEl.appendChild(p);
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ── Status UI ─────────────────────────────────────────────────────
function setStatus(kind: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error', text: string): void {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
}

function langLabel(code: string): string {
  return CONFIG.languages.find((l) => l.code === code)?.label ?? code;
}

// ── Start / Stop ──────────────────────────────────────────────────
async function start(): Promise<void> {
  if (state.running) return;
  state.targetLanguage = langSelect.value;
  state.micDeviceId = micSelect.value;
  actionBtn.disabled = true;
  segments.clear();
  renderTranscript();

  try {
    setStatus('connecting', 'Creating session…');
    const session = await createSession();
    state.sessionId = session.sessionId;

    setStatus('connecting', 'Connecting to room…');
    const room = await joinRoom(session.sessionId, session.organizerIdentity);
    state.room = room;

    setStatus('connecting', 'Starting microphone…');
    await startMicCapture(room);

    setStatus('connecting', 'Starting translation…');
    await startTranslation(session.sessionId, state.targetLanguage);

    state.running = true;
    setStatus('live', 'Translating · server connected');
    actionBtn.textContent = '■ Stop Translating';
    actionBtn.classList.add('stop');
    micSelect.disabled = langSelect.disabled = true;

    electronAPI.updateStatus({ translating: true, from: '中文', to: langLabel(state.targetLanguage) });
    startStatsPolling();
  } catch (err) {
    console.error('start failed:', err);
    setStatus('error', `Error: ${(err as Error).message}`);
    await cleanup();
  } finally {
    actionBtn.disabled = false;
  }
}

async function stop(): Promise<void> {
  if (!state.running && !state.room) return;
  actionBtn.disabled = true;
  await cleanup();
  setStatus('idle', 'Stopped');
  actionBtn.textContent = '▶ Start Translating';
  actionBtn.classList.remove('stop');
  actionBtn.disabled = false;
  micSelect.disabled = langSelect.disabled = false;
  electronAPI.updateStatus({ translating: false });
}

async function cleanup(): Promise<void> {
  state.running = false;
  stopStatsPolling();
  if (state.sessionId) await endSession(state.sessionId);
  if (state.room) {
    await state.room.disconnect().catch(() => {});
    state.room = null;
  }
  if (state.audioEl) {
    state.audioEl.pause();
    state.audioEl.srcObject = null;
  }
  state.sessionId = null;
}

// ── Token usage polling ───────────────────────────────────────────
function startStatsPolling(): void {
  const tick = async () => {
    if (!state.sessionId) return;
    const tokens = await fetchTokenUsage(state.sessionId);
    statsEl.textContent = tokens ? `${tokens.toLocaleString()} tokens` : '';
  };
  tick();
  state.statsTimer = window.setInterval(tick, 5000);
}
function stopStatsPolling(): void {
  if (state.statsTimer) {
    clearInterval(state.statsTimer);
    state.statsTimer = null;
  }
  statsEl.textContent = '';
}

// ── Wire up UI ────────────────────────────────────────────────────
function populateLanguages(): void {
  langSelect.innerHTML = '';
  for (const l of CONFIG.languages) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.label;
    langSelect.appendChild(opt);
  }
  langSelect.value = state.targetLanguage;
}

actionBtn.addEventListener('click', () => (state.running ? stop() : start()));
micSelect.addEventListener('change', () => (state.micDeviceId = micSelect.value));
langSelect.addEventListener('change', () => (state.targetLanguage = langSelect.value));

setupInstallBtn.addEventListener('click', () => installDriver());
$('setup-retry').addEventListener('click', () => checkVirtualDevice());
$('setup-dismiss').addEventListener('click', () => setupGuide.classList.add('hidden'));

navigator.mediaDevices.addEventListener('devicechange', () => refreshDevices());

electronAPI.onTrayAction((action) => {
  if (action === 'start') start();
  else stop();
});

window.addEventListener('beforeunload', () => {
  if (state.sessionId) navigator.sendBeacon(url(`${api.sessionsEndpoint}/${state.sessionId}/end`));
});

// ── Boot ──────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  populateLanguages();
  setStatus('idle', 'Ready');
  await checkVirtualDevice();
}
boot();
