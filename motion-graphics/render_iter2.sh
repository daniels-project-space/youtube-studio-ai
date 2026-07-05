#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/youtube-studio-ai/motion-graphics
OUT=out/craft/iter2
WEB=/var/www/html/motioncraft/examples/v6/iter2
mkdir -p "$OUT/strip" "$WEB"

echo "### [1/5] render silent video $(date -u +%H:%M:%S)"
npx remotion render src/examples-v6-index.ts CraftKineticLine "$OUT/CraftKineticLine.mp4" \
  --concurrency 4 --image-format jpeg --log info

echo "### [2/5] mux trimmed audio (-ss 0.9) $(date -u +%H:%M:%S)"
ffmpeg -y -loglevel error -i "$OUT/CraftKineticLine.mp4" -ss 0.9 -i out/craft/ref_audio.aac \
  -map 0:v -map 1:a -c:v copy -c:a aac -shortest "$OUT/CraftKineticLine_av.mp4"

echo "### [3/5] dense frame strips (FEEL 38-54, PROSPERITY 100-118) $(date -u +%H:%M:%S)"
ffmpeg -y -loglevel error -i "$OUT/CraftKineticLine.mp4" -vf "select=between(n\,38\,54)" -vsync 0 -frame_pts 1 "$OUT/strip/feel_%d.jpg"
ffmpeg -y -loglevel error -i "$OUT/CraftKineticLine.mp4" -vf "select=between(n\,100\,118)" -vsync 0 -frame_pts 1 "$OUT/strip/pros_%d.jpg"

echo "### [4/5] full settle frames + contact sheets $(date -u +%H:%M:%S)"
ffmpeg -y -loglevel error -i "$OUT/CraftKineticLine.mp4" -vf "select=eq(n\,50)" -vframes 1 "$OUT/full_beat1_f50.jpg"
ffmpeg -y -loglevel error -i "$OUT/CraftKineticLine.mp4" -vf "select=eq(n\,112)" -vframes 1 "$OUT/full_beat2_f112.jpg"
montage "$OUT"/strip/feel_*.jpg -tile 6x -geometry 320x180+3+3 -background black -fill white -label "%t" "$OUT/feel_strip.jpg"
montage "$OUT"/strip/pros_*.jpg -tile 7x -geometry 300x169+3+3 -background black -fill white -label "%t" "$OUT/pros_strip.jpg"

echo "### [5/5] publish to web $(date -u +%H:%M:%S)"
cp "$OUT/CraftKineticLine.mp4" "$OUT/CraftKineticLine_av.mp4" "$OUT/feel_strip.jpg" "$OUT/pros_strip.jpg" "$OUT/full_beat1_f50.jpg" "$OUT/full_beat2_f112.jpg" "$WEB/"
echo "### DONE $(date -u +%H:%M:%S)"
ls -la "$OUT"
