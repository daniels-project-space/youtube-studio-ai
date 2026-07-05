#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/youtube-studio-ai/motion-graphics/out/craft/ref
W=/var/www/html/motioncraft/examples/v6/ref/scenes
mkdir -p "$W"
clip () { # name start end
  ffmpeg -y -loglevel error -ss "$2" -to "$3" -i ref.mp4 -c:v libx264 -pix_fmt yuv420p -crf 20 -c:a aac "$W/$1.mp4"
  echo "$1.mp4  ($2-$3s)"
}
clip 01_prosperity_kinetictype   1.5  7
clip 02_gospel_illustration      7    13
clip 03_smash_your_car           85   94
clip 04_clouds_flesh_may_fail    116  125
clip 05_god_is_enough            102  109
echo "---"; ls -la "$W"
