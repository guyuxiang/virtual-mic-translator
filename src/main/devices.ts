/**
 * Platform-specific virtual audio device detection.
 *
 * Each platform uses a different free virtual audio driver:
 *   macOS   → BlackHole 2ch
 *   Windows → VB-Cable
 *   Linux   → PulseAudio null-sink
 *
 * Returns { installed, deviceName, guide } where `guide` is the install
 * instructions shown in the first-run setup panel.
 */

import { execSync } from 'child_process';

export interface VirtualDeviceInfo {
  installed: boolean;
  deviceName: string;
  guide: string;
}

export function detectVirtualDevice(): VirtualDeviceInfo {
  switch (process.platform) {
    case 'darwin':
      return detectMacOS();
    case 'win32':
      return detectWindows();
    case 'linux':
      return detectLinux();
    default:
      return { installed: false, deviceName: '', guide: 'Unsupported operating system.' };
  }
}

function detectMacOS(): VirtualDeviceInfo {
  try {
    const output = execSync(
      'system_profiler SPAudioDataType 2>/dev/null | grep -i "BlackHole"',
      { encoding: 'utf-8' }
    );
    if (output.trim()) {
      return { installed: true, deviceName: 'BlackHole 2ch', guide: '' };
    }
  } catch {
    /* not installed */
  }
  return {
    installed: false,
    deviceName: 'BlackHole 2ch',
    guide: [
      '1. Open Terminal',
      '2. Run: brew install blackhole-2ch',
      '3. Restart this app',
      '4. In Zoom/Teams/Meet, select "BlackHole 2ch" as microphone',
    ].join('\n'),
  };
}

function detectWindows(): VirtualDeviceInfo {
  try {
    // No external module needed — query the registry's MMDevices render endpoints.
    const output = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name | Out-String"',
      { encoding: 'utf-8' }
    );
    if (/CABLE/i.test(output)) {
      return { installed: true, deviceName: 'CABLE Input', guide: '' };
    }
  } catch {
    /* powershell failed — assume not installed */
  }
  return {
    installed: false,
    deviceName: 'CABLE Input',
    guide: [
      '1. Download VB-Cable from: https://vb-audio.com/Cable/',
      '2. Run the installer and restart your computer',
      '3. Restart this app',
      '4. In Zoom/Teams/Meet, select "CABLE Output" as microphone',
    ].join('\n'),
  };
}

function detectLinux(): VirtualDeviceInfo {
  // Check PulseAudio / PipeWire (pactl works for both via pipewire-pulse).
  try {
    const output = execSync('pactl list short sinks 2>/dev/null', { encoding: 'utf-8' });
    if (/virtual_translator/.test(output)) {
      return { installed: true, deviceName: 'virtual_translator', guide: '' };
    }
  } catch {
    /* pactl missing or no server */
  }
  return {
    installed: false,
    deviceName: 'virtual_translator',
    guide: [
      'Run these two commands in a terminal:',
      '',
      'pactl load-module module-null-sink \\',
      '  sink_name=virtual_translator \\',
      '  sink_properties=device.description=Virtual_Translator',
      '',
      'pactl load-module module-remap-source \\',
      '  source_name=translate_mic \\',
      '  master=virtual_translator.monitor \\',
      '  source_properties=device.description=Translate_Mic',
      '',
      'Then restart this app and select "Translate_Mic" as your mic.',
    ].join('\n'),
  };
}
