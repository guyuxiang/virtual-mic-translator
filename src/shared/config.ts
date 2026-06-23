// Shared configuration between main and renderer processes.
//
// NOTE: the LiveKit websocket URL is NOT hardcoded here — the server's
// /api/token endpoint returns the correct `serverUrl` (currently
// wss://www.openshort.cloud/livekit) and we always use that.
export const CONFIG = {
  server: {
    // The live-translate Next.js server (public domain, reachable from any machine).
    baseUrl: 'https://www.openshort.cloud',
    tokenEndpoint: '/api/token',
    sessionsEndpoint: '/api/sessions',
    translateEndpoint: '/api/translate',
  },
  session: {
    // SESSION_PASSWORD — must match the server's .env
    password: 'Aa123456!',
    organizerName: 'desktop',
  },
  languages: [
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'ko', label: '한국어' },
    { code: 'zh', label: '中文' },
    { code: 'pt', label: 'Português' },
    { code: 'ru', label: 'Русский' },
    { code: 'ar', label: 'العربية' },
  ],
  audio: {
    // Critical: disable all Chromium audio processing to preserve the
    // raw voice signal for Gemini translation.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
} as const;

export type LanguageCode = (typeof CONFIG.languages)[number]['code'];
