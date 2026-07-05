#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/youtube-studio-ai/motion-graphics/out/craft/vids
dl () { # id name everyN tile
  yt-dlp --no-warnings -f "best[height<=480]/bestvideo[height<=480]+bestaudio/best" -o "$2.%(ext)s" "https://www.youtube.com/watch?v=$1" >/dev/null 2>&1 || \
  yt-dlp --no-warnings -f "bv*[height<=480]+ba/b[height<=480]" --merge-output-format mp4 -o "$2.%(ext)s" "https://www.youtube.com/watch?v=$1" >/dev/null 2>&1
  f=$(ls $2.* | head -1)
  mkdir -p sheet_$2
  ffmpeg -y -loglevel error -i "$f" -vf "fps=1/$3,scale=320:-1" sheet_$2/f_%03d.jpg
  n=$(ls sheet_$2/*.jpg | wc -l)
  montage sheet_$2/*.jpg -tile $4 -geometry 320x180+2+2 -background black sheet_$2.jpg
  echo "$2: $f, $n frames -> sheet_$2.jpg"
}
dl eSeYBr_iEs4 got 4 7x
dl oAlP8IzWghs fern 20 8x
