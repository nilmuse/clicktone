#!/usr/bin/env bash
set -euo pipefail

# Headless Linux runners have no hardware output. Firefox needs a functioning
# audio server for AudioContext.resume() to settle and its clock to advance.
sudo apt-get install --yes pulseaudio pulseaudio-utils
pulseaudio --start --exit-idle-time=-1
pactl load-module module-null-sink sink_name=clicktone
pactl set-default-sink clicktone
pactl info
