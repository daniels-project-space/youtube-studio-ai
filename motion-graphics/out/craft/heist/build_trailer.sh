#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/youtube-studio-ai/motion-graphics/out/craft/heist
rm -rf shots; mkdir -p shots
GRADE="scale=1920:1080:flags=lanczos,eq=contrast=1.05:saturation=1.08,vignette=angle=PI/5,noise=alls=4:allf=t,unsharp=3:3:0.30,format=yuv420p"
ORDER="city vault grid steel breach gem title"
: > shots/list.txt
for s in $ORDER; do
  echo "## grading $s ($(ls frames/$s/*.png 2>/dev/null|wc -l) frames)"
  ffmpeg -y -loglevel error -framerate 24 -pattern_type glob -i "frames/$s/*.png" -vf "$GRADE" -r 24 -c:v libx264 -preset medium -crf 18 "shots/$s.mp4"
  echo "file $PWD/shots/$s.mp4" >> shots/list.txt
done
ffmpeg -y -loglevel error -f concat -safe 0 -i shots/list.txt -c copy shots/silent.mp4
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 shots/silent.mp4); echo "video dur=$DUR"
# --- audio elements ---
ffmpeg -y -loglevel error -f lavfi -i "sine=f=50:d=1.2" -f lavfi -i "sine=f=92:d=1.2" -filter_complex "[0]volume=exp(-t*3.5):eval=frame[a];[1]volume=exp(-t*6)*0.5:eval=frame[b];[a][b]amix=2:normalize=0,aformat=channel_layouts=stereo:sample_rates=48000,volume=3.0" shots/impact.wav
ffmpeg -y -loglevel error -f lavfi -i "sine=f=42:d=2.4" -f lavfi -i "sine=f=70:d=2.4" -filter_complex "[0]volume=exp(-t*1.8):eval=frame[a];[1]volume=exp(-t*3)*0.5:eval=frame[b];[a][b]amix=2:normalize=0,aformat=channel_layouts=stereo:sample_rates=48000,volume=3.5" shots/titleboom.wav
ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=d=3:c=pink:a=0.6" -af "highpass=f=320,volume=(t/3)*(t/3):eval=frame,aformat=channel_layouts=stereo:sample_rates=48000,volume=1.4" shots/riser.wav
ffmpeg -y -loglevel error -ss 30 -t 58 -i /home/ubuntu/passive-income/ai-music-empire/references/epic_cinematic.mp3 -af "afade=t=in:d=1.5,afade=t=out:st=54:d=4,aformat=channel_layouts=stereo:sample_rates=48000,volume=0.5" shots/music.wav
# --- VO track (8 lines placed on the timeline) ---
ffmpeg -y -loglevel error -i vo/vo_1.mp3 -i vo/vo_2.mp3 -i vo/vo_3.mp3 -i vo/vo_4.mp3 -i vo/vo_5.mp3 -i vo/vo_6.mp3 -i vo/vo_7.mp3 -i vo/vo_8.mp3 -filter_complex \
"[0]aformat=channel_layouts=stereo:sample_rates=48000,adelay=600|600,volume=2.3[a0];[1]aformat=channel_layouts=stereo:sample_rates=48000,adelay=7600|7600,volume=2.3[a1];[2]aformat=channel_layouts=stereo:sample_rates=48000,adelay=15600|15600,volume=2.3[a2];[3]aformat=channel_layouts=stereo:sample_rates=48000,adelay=23400|23400,volume=2.3[a3];[4]aformat=channel_layouts=stereo:sample_rates=48000,adelay=31800|31800,volume=2.3[a4];[5]aformat=channel_layouts=stereo:sample_rates=48000,adelay=40600|40600,volume=2.3[a5];[6]aformat=channel_layouts=stereo:sample_rates=48000,adelay=47400|47400,volume=2.3[a6];[7]aformat=channel_layouts=stereo:sample_rates=48000,adelay=54000|54000,volume=2.6[a7];[a0][a1][a2][a3][a4][a5][a6][a7]amix=inputs=8:duration=longest:normalize=0[vo]" -map "[vo]" -t 58 shots/vo_track.wav
# --- final mix ---
ffmpeg -y -loglevel error -i shots/music.wav -i shots/vo_track.wav -i shots/impact.wav -i shots/titleboom.wav -i shots/riser.wav -filter_complex \
"[2]asplit=4[k1][k2][k3][k4];[k1]adelay=7000|7000[i1];[k2]adelay=23000|23000[i2];[k3]adelay=31000|31000[i3];[k4]adelay=47000|47000[i4];[4]adelay=45000|45000[ri];[3]adelay=54000|54000[tb];[0][1][i1][i2][i3][i4][ri][tb]amix=inputs=8:duration=first:normalize=0,alimiter=limit=0.95[a]" -map "[a]" -t 58 shots/mix.wav
# --- mux + fades ---
ffmpeg -y -loglevel error -i shots/silent.mp4 -i shots/mix.wav -filter_complex "[0:v]fade=t=in:st=0:d=0.8,fade=t=out:st=55.5:d=1.5,format=yuv420p[v]" -map "[v]" -map "1:a" -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 320k -movflags +faststart antwerp_blender_trailer.mp4
cp antwerp_blender_trailer.mp4 /var/www/html/geocinema/antwerp_blender_trailer.mp4
echo "TRAILER_DONE $(ffprobe -v error -show_entries format=duration -of csv=p=0 antwerp_blender_trailer.mp4)s"
