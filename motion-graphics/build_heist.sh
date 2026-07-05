#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/youtube-studio-ai/motion-graphics/out/craft/heist
rm -f seg_*.mp4 list.txt
G=/var/www/html/geocinema; M=/var/www/html/motioncraft; B=/home/ubuntu/backups; FV=/home/ubuntu/freegfx/media/videos/vault/1080p30
GRADE="eq=contrast=1.06:saturation=1.12:gamma=0.97,vignette=angle=PI/5,noise=alls=5:allf=t,unsharp=3:3:0.35"
SCALE="scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,setsar=1"
SEGS=(
"$G/free-globe-cesium.mp4|0.2|5.0"
"$B/antwerp-cityzoom-hyperframes.mp4|0.5|5.5"
"$G/antwerp-cinema-v7.mp4|2.0|6.5"
"$M/antwerp-map.mp4|0.3|4.5"
"$G/free-vault-blender.mp4|0.0|4.0"
"$G/hera-3-vault-section.mp4|1.5|6.0"
"$B/antwerp-heist-documotion.mp4|27|7.0"
"$M/heist-stats.mp4|0.3|6.5"
"$FV/VaultDescent.mp4|3.0|5.5"
"$M/never-solved-hero.mp4|0.0|7.0"
)
i=0
for s in "${SEGS[@]}"; do
  IFS="|" read -r src ss dur <<< "$s"
  printf -v n "seg_%02d.mp4" "$i"
  echo "## $n  <- $(basename "$src")  ss=$ss dur=$dur"
  ffmpeg -y -loglevel error -ss "$ss" -t "$dur" -i "$src" -an \
    -vf "$SCALE,$GRADE" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 "$n"
  echo "file ${PWD}/$n" >> list.txt
  i=$((i+1))
done
echo "### concat"
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy montage.mp4
echo "### audio elements"
ffmpeg -y -loglevel error -f lavfi -i "sine=f=50:d=1.2" -f lavfi -i "sine=f=92:d=1.2" \
  -filter_complex "[0]volume=exp(-t*3.5):eval=frame[a];[1]volume=exp(-t*6)*0.5:eval=frame[b];[a][b]amix=2:normalize=0,aformat=channel_layouts=stereo:sample_rates=48000,volume=3.0" impact.wav
ffmpeg -y -loglevel error -f lavfi -i "sine=f=42:d=2.4" -f lavfi -i "sine=f=70:d=2.4" \
  -filter_complex "[0]volume=exp(-t*1.8):eval=frame[a];[1]volume=exp(-t*3)*0.5:eval=frame[b];[a][b]amix=2:normalize=0,aformat=channel_layouts=stereo:sample_rates=48000,volume=3.5" titleboom.wav
ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=d=3:c=pink:a=0.6" \
  -af "highpass=f=320,volume=(t/3)*(t/3):eval=frame,aformat=channel_layouts=stereo:sample_rates=48000,volume=1.4" riser.wav
ffmpeg -y -loglevel error -ss 30 -t 57.5 -i /home/ubuntu/passive-income/ai-music-empire/references/epic_cinematic.mp3 \
  -af "afade=t=in:d=1.5,afade=t=out:st=53.5:d=4,aformat=channel_layouts=stereo:sample_rates=48000,volume=0.85" music.wav
echo "### mix"
ffmpeg -y -loglevel error -i music.wav -i impact.wav -i titleboom.wav -i riser.wav -filter_complex \
"[1]asplit=4[c1][c2][c3][c4];[c1]adelay=21500|21500[i1];[c2]adelay=31500|31500[i2];[c3]adelay=38500|38500[i3];[c4]adelay=45000|45000[i4];[3]adelay=47500|47500[ri];[2]adelay=50500|50500[tb];[0][i1][i2][i3][i4][ri][tb]amix=inputs=7:duration=first:normalize=0,alimiter=limit=0.92[a]" \
  -map "[a]" -t 57.5 mix.wav
echo "### final mux + grade fades"
ffmpeg -y -loglevel error -i montage.mp4 -i mix.wav \
  -filter_complex "[0:v]fade=t=in:st=0:d=0.8,fade=t=out:st=56.0:d=1.5,format=yuv420p[v]" \
  -map "[v]" -map "1:a" -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 320k -movflags +faststart antwerp_heist_intro.mp4
cp antwerp_heist_intro.mp4 /var/www/html/geocinema/antwerp_heist_intro_60s.mp4
echo "### DONE"; ffprobe -v error -show_entries format=duration:stream=width,height -of default=noprint_wrappers=1 antwerp_heist_intro.mp4 | head; ls -la antwerp_heist_intro.mp4
