# Studio weekly scene submission

This change depends on the approved local Studio cutover/pause series through `ee2758ab`; GitHub main was `e2cfb502` when work began. It also requires the Render Engine expected-scene admission change before deploying this caller.

The existing caller remains `planWeekPreparedNarration` → `plan-week-prepared-images` → `dispatchPreparedFootage`. After verifying the retained prepared-image packet, it builds every H3 scene with the existing prompts, seeds, five-second duration and 1280×736/24fps H.264 output. No scene is dropped or replaced.

Before staging a job, Studio stores a create-only canonical `preparation/h3-scenes.json` in its own R2 bucket. The packet freezes the batch/item identity, original preparation and image-receipt hashes, scene IDs/ordinals, exact H3 requests, and real conditioning-frame source keys/hashes/byte counts. Engine verifies the complete packet and all source frame bytes through `/client/studio-batch-scenes`, with a five-minute verification deadline; the caller permits 330 seconds for that response.

Each scene has one fixed idempotency key. If an accepted staging response is lost, the task replays every scene under its original identity and receives the durable job state. A changed packet cannot overwrite the intent or buy a new attempt. The final staged-footage sidecar retains the actual Engine job IDs and request hashes for the existing verified output materializer.

Studio remains paused. No deployment, Trigger run, provider allocation, paid API call, or Final qualification has occurred. The implemented path uses real verified retained prepared-image packets. Creating new conditioning stills remains blocked by the existing retired generation path until the separately qualified Engine image preparation is connected. Finished output still requires the existing Engine verified readback and Studio R2 materializer; staging is not completion.

The existing per-scene cost cap is preserved, not raised or converted into a weekly allowance. A shared GPU/model-once bulk worker and safe partial-scene repair remain unfinished execution work. Frozen failed or uncertain scenes cannot obtain another job by changing their key.
