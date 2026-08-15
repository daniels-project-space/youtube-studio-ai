#!/usr/bin/env bash
set -euo pipefail

# A controller process should delete its own GPU in `finally`. This independent
# watchdog closes the only remaining failure mode: a lost local supervisor
# while Novita still has a billable managed staging worker.
stage_session="${LTX_STAGE_SESSION:-ltx25-stage-v2}"
stage_log="${LTX_STAGE_LOG:-/var/tmp/youtube-studio-ltx25-stage-v2.log}"
watchdog_log="${LTX_STAGE_WATCHDOG_LOG:-/var/tmp/youtube-studio-ltx25-stage-v2-watchdog.log}"

while tmux has-session -t "$stage_session" 2>/dev/null; do
  sleep 30
done

if rg -q '"event":"deletedVerified"' "$stage_log" 2>/dev/null; then
  printf '%s controller completed with verified teardown\n' "$(date -u +%FT%TZ)" >> "$watchdog_log"
  exit 0
fi

instance_id="$(sed -nE 's/.*"instanceId":"([a-z0-9]+)".*/\1/p' "$stage_log" | head -1)"
if [[ ! "$instance_id" =~ ^[a-z0-9]{16}$ ]]; then
  printf '%s controller exited without a safe instance identity; manual account audit required\n' "$(date -u +%FT%TZ)" >> "$watchdog_log"
  exit 2
fi

printf '%s controller exited unexpectedly; reaping %s\n' "$(date -u +%FT%TZ)" "$instance_id" >> "$watchdog_log"
export LTX_ORPHAN_INSTANCE_ID="$instance_id"
codex-vault-exec novita NOVITA_API_KEY=NOVITA_API_KEY -- python3 - <<'PY' >> "$watchdog_log" 2>&1
import json, os, time, urllib.request
instance_id = os.environ['LTX_ORPHAN_INSTANCE_ID']
base = 'https://api.novita.ai/gpu-instance/openapi/v1'
headers = {'Authorization': 'Bearer ' + os.environ['NOVITA_API_KEY'], 'Content-Type': 'application/json', 'User-Agent': 'youtube-studio-ai/ltx25-stage-watchdog'}
def call(path, method='GET', payload=None):
    request = urllib.request.Request(base + path, data=json.dumps(payload).encode() if payload else None, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read() or b'{}')
for path in ('/gpu/instance/stop', '/gpu/instance/delete'):
    try: call(path, 'POST', {'instanceId': instance_id})
    except Exception: pass
for _ in range(24):
    try:
        current = call('/gpu/instance?instanceId=' + instance_id)
        if str(current.get('status') or '').lower() in {'removed', 'deleted', ''}: break
    except Exception: break
    time.sleep(5)
else:
    raise SystemExit('watchdog could not verify Novita worker deletion')
print(json.dumps({'event':'watchdogDeletedVerified','instanceId':instance_id}))
PY
