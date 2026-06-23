#!/usr/bin/env bash
# Create a PulseAudio/PipeWire virtual microphone for Virtual Mic Translator.
#
# Creates a null-sink the app routes translated audio into (via setSinkId),
# plus a remapped source so Zoom/Teams/Meet can pick it as a microphone.
set -euo pipefail

echo "Creating virtual_translator null-sink…"
pactl load-module module-null-sink \
  sink_name=virtual_translator \
  sink_properties=device.description=Virtual_Translator

echo "Creating Translate_Mic source from the sink monitor…"
pactl load-module module-remap-source \
  source_name=translate_mic \
  master=virtual_translator.monitor \
  source_properties=device.description=Translate_Mic

echo "Done. In your meeting app, select 'Translate_Mic' as the microphone."
echo "Restart Virtual Mic Translator and click Re-detect if the warning is still shown."
