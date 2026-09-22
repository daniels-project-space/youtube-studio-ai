# OpenRelay vault access recovered

The previously reported authentication blocker is cleared at the canonical
vault record. Checking only `youtube/OPENRELAY_API_KEY` was insufficient:
`openrelay/OPENRELAY_API_KEY` held a different, working key for the same
organization. No key value was printed, committed, or stored in a new local file.

## Verified Provider Evidence

The shared key passed a real read-only `/v1/whoami` request with HTTP 200 and the
expected organization. It then passed the application's strict retained-VM
admission check, including identity, VM detail, and burn endpoints.

- VM: `29e245a2-2e1a-431e-b5b3-654cf0ba1587`, stopped.
- Shape: one RTX 3090, 24 GB VRAM, 28 GB guest RAM, 60 GB disk, private community VM.
- Current read-only billing evidence: 18 cents/hour, disk billing disabled.
- Reported scopes: clusters read, VMs read/write. Scope labels are not proof of
  successful start/stop writes or restart capacity.

After validation, the vault bridge replaced the revoked
`youtube/OPENRELAY_API_KEY` entry, removing its one old record. The shared service
record was retained for its other consumers. Studio's organization record
already matched and was not changed.

A second complete admission check fetched credentials from the canonical
`youtube` service and passed at `2026-09-22T08:43:06.270Z`. The canonical key
fingerprint is now `26ed1345e3b8`, not the revoked `becf652a4be6`. These are short
SHA-256 fingerprints, not credential values. The operator state was updated to
the new fingerprint while retaining the prior fingerprint as audit metadata.

## Cleanup Scope

- 2,770 tracked app text files scanned: no OpenRelay key-shaped literals.
- 44 tracked music-runtime text files scanned: no OpenRelay key-shaped literals.
- 32 top-level operator JSON/script files scanned: no key-shaped literals.
- App `.env.local`: no OpenRelay API-key or worker-token copy.

The bounded text scans cover files up to 2 MiB and the known `or_` key format.
They do not claim to scan Git history, unrelated projects, encrypted stores, all
logs, or running-process environments. Historical fingerprint records remain;
they are not usable secrets. No shared working credential was deleted.

## Remaining GPU Boundary

No VM restart, new allocation, generation, or paid request was made. The retained
operator ledger still conservatively reserves 63 cents of the approved 100-cent
total; those reservations are not an observed provider bill. Its previous
execution deadline remains expired. A fresh guarded window and verified stop
mechanism are required before resuming the retained VM.

Vault recovery does not prove that previously bootstrapped services have refreshed
their environment. This record proves fresh canonical vault injection and real
provider read access, not a production deployment, GPU runtime qualification,
or owner approval of the retained music.

Local non-secret evidence: `/tmp/studio-openrelay-shared-key-readonly-20260922.log`
and `/tmp/studio-openrelay-canonical-key-readonly-20260922.log`.
