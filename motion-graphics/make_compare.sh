#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/youtube-studio-ai/motion-graphics/out/craft
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
REF=ref/ref.mp4
OURS=iter5/CraftKineticLine_av.mp4
OUT=ref/compare_animated.mp4
ffmpeg -y -loglevel error -ss 0 -t 7 -i "$REF" -i "$OURS" -filter_complex "
[0:v]scale=960:540,setsar=1,drawtext=fontfile=$FONT:text=REFERENCE (real video):x=24:y=20:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10[top];
[1:v]scale=960:540,setsar=1,tpad=stop_mode=clone:stop_duration=2,drawtext=fontfile=$FONT:text=OURS - iter5 (Remotion):x=24:y=20:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10[bot];
[top][bot]vstack=inputs=2[v]" -map "[v]" -map 0:a -t 7 -c:v libx264 -pix_fmt yuv420p -crf 20 -c:a aac "$OUT"
cp "$OUT" /var/www/html/motioncraft/examples/v6/ref/
echo OK; ls -la "$OUT"
