#!/usr/bin/env bash
cd /home/ubuntu/youtube-studio-ai/motion-graphics/out/craft/heist
rm -rf prev; mkdir prev
for s in city vault grid steel breach gem title; do
  echo "$(date +%T) START $s"
  blender -b -noaudio -t 6 -P trailer.py -- "$s" prev preview > prev/log_$s.txt 2>&1
  echo "$(date +%T) DONE $s rc=$? -> $(ls prev/prev_$s.png 2>/dev/null && echo ok || echo MISSING)"
done
montage prev/prev_city.png prev/prev_vault.png prev/prev_grid.png prev/prev_steel.png prev/prev_breach.png prev/prev_gem.png prev/prev_title.png -tile 4x -geometry 426x240+3+3 -background black -fill yellow -label "%t" prev_sheet.jpg
echo "ALL_PREVIEWS_DONE"
