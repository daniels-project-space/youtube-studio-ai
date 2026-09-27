# YouTube Studio R2 asset retention

The scheduled `r2-asset-retention-sweeper` runs daily. It uses R2 `LastModified`
and the exact object key. Within certificate-bound `owner/<owner>/channel/<slug>/runs/<run>/`
namespaces, generated intermediates are eligible only after confirmed public
YouTube release plus 30 days. Final video masters require release plus 180 days.
The existing release cleanup ledger must be completed, and R2 `LastModified`
must also satisfy the matching 30 or 180 day age. Active runs and locked
channels are skipped. The task is hard-bound to `youtube-studio-ai` and deletes at
most 100 acknowledged objects per execution and rechecks the object's timestamp
and ETag immediately before deletion. An authenticated Convex intent is stored
before deletion; exact asset metadata is removed and the intent marked expired
after R2 acknowledges deletion. Pending intents hide final video playback and
are reconciled against R2 on the next sweep if a worker crashes between storage
and database writes. The intent transaction rechecks owner/run/release/channel
identity and every reusable revision. New library and reusable-media promotions
reject a pending or expired key, and channel locking waits for pending deletion
to finish or cancel.
Immediately before the R2 request, the worker reads the exact YouTube video
through its bound connector. Convex verifies that observation is fresh,
public, processed, on the same channel, and still has the recorded publication
timestamp. A private, missing, or changed video blocks deletion.

Protected keys include every revision of the Studio Asset Library, every
reusable media entry, every key in the run's sealed release certificates,
release evidence already recorded by the older cleanup ledger, run keep names,
and thumbnail assets/checkpoints. A final video named in a release certificate
or video/derived-short asset row is exempt from the 30-day rule and becomes
eligible at 180 days. The earlier release-aware sweeper now waits 30 days after
confirmed publication and also protects exact reusable-library keys.

The older `owner/<owner>/channel/<slug>/footage/run/<run>/clip_N.mp4` layout is
also eligible only after confirmed release plus 30 days and completed cleanup,
when Convex resolves the exact run ID and channel slug, the channel is unlocked, and
the key is absent from the reusable library. No bucket-wide R2 lifecycle rule
is used because model/runtime weights and reusable assets share this bucket.

`scripts/report-r2-retention-candidates.ts INVENTORY.jsonl` is a read-only
classifier for observed unbound `videocraft`, `lustig`, `imagecraft`, and
`validation` layouts. It never deletes them: those layouts lack an authoritative
Convex owner/run binding. Validation visual-review evidence is explicitly
reported as protected, and known noncanonical final MP4 names are reported
with the 180-day threshold. All other keys are outside the automated scope.

At the 27 September 2026 inventory, the report classified 80 generated media
objects (4.13 GB) as over 30 days, including 44 owner footage clips (4.10 GB)
which the exact-run task can evaluate. It classified seven noncanonical final
videos (1.08 GB), none over 180 days, plus 655 validation evidence objects
(102 MB) that remain protected. The report's age classification alone never
proves deletion eligibility; live Convex checks may exclude the owner footage.

No production candidate cleanup has been run by this change. Previously
completed 14-day cleanup cannot be reversed. An isolated random object in the
YouTube bucket proved R2 accepts `DeleteObject.IfMatch` with a wrong ETag and
still deletes the object, so this implementation does not rely on conditional
delete. The application-level intent fence prevents library promotion and
channel locking during deletion. R2 and Convex remain separate systems; an
out-of-band writer that ignores Studio's released-run immutability contract
could still replace bytes between the last HEAD and deletion. Such writes must
not be used against finished run keys. The seven noncanonical final videos and
unbound media families remain report-only pending an authoritative run binding.
