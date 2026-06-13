#!/bin/bash
# Render the Lustig PoC: per shot -> soul keyframe (soul_cinematic + custom_reference_id)
# -> Seedance 1.5 i2v with camera-move prompt. Outputs clip URLs to /tmp/clips.txt.
export HIGGSFIELD_LIVE=1
SOUL=$(cat /tmp/soulid.txt)
echo "soul=$SOUL"
: > /tmp/clips.txt
N=$(python3 -c "import json; print(len(json.load(open('/tmp/shotplan.json'))['shots']))")
for i in $(seq 0 $((N-1))); do
  KF=$(python3 -c "import json; print(json.load(open('/tmp/shotplan.json'))['shots'][$i]['keyframePrompt'])")
  IV=$(python3 -c "import json; print(json.load(open('/tmp/shotplan.json'))['shots'][$i]['i2vPrompt'])")
  echo "=== shot $((i+1)) keyframe ==="
  KID=$(higgsfield generate create soul_cinematic --custom-reference-id "$SOUL" --aspect-ratio 16:9 --prompt "$KF" --wait --wait-timeout 6m --json 2>&1 | python3 -c "import sys,json,re; raw=sys.stdin.read();
import re as r; m=r.search(r'_([0-9a-f-]{36})\.(?:png|jpg|jpeg|webp)', raw); print(m.group(1) if m else NONE)")
  echo "keyframe job=$KID"
  [ "$KID" = "NONE" ] && { echo "keyframe failed shot $((i+1))"; continue; }
  echo "=== shot $((i+1)) seedance i2v ==="
  CURL=$(higgsfield generate create seedance1_5 --image "$KID" --aspect-ratio 16:9 --resolution 1080p --duration 4 --prompt "$IV" --wait --wait-timeout 12m --json 2>&1 | python3 -c "import sys,json,re; raw=sys.stdin.read(); m=re.search(r'https?://[^\"\ ]+\.mp4', raw); print(m.group(0) if m else NONE)")
  echo "clip=$CURL"
  echo "$CURL" >> /tmp/clips.txt
done
echo "DONE clips:"; cat /tmp/clips.txt
