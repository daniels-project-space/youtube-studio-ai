#!/usr/bin/env bash
cd /home/ubuntu/youtube-studio-ai/motion-graphics/out/craft/heist
mkdir -p frames
SHOTS="title gem city steel grid breach vault"   # heavy ones spread out
render_one(){ blender -b -noaudio -t 4 -P trailer.py -- "$1" "frames/$1" > "frames/log_$1.txt" 2>&1; echo "$(date +%T) DONE $1 ($(ls frames/$1/$1_*.png 2>/dev/null|wc -l)f)"; }
for s in $SHOTS; do
  while [ "$(jobs -rp | wc -l)" -ge 2 ] || [ "$(free -m|awk "/Mem:/{print \$7}")" -lt 4000 ]; do sleep 5; done
  echo "$(date +%T) START $s (free $(free -m|awk "/Mem:/{print \$7}")MB)"
  render_one "$s" &
done
wait
echo "ALL_FRAMES_DONE $(date +%T)"
