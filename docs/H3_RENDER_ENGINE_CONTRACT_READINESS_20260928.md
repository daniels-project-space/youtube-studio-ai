# Weekly H3 Render Engine contract readiness

Studio's weekly H3 order is a frozen image-to-video batch. Each shot has a
first-frame R2 key and digest, owner-scoped output key, seed, per-shot cost cap,
and the pinned `official-turbo8-native-768p` profile (1344×768, 24 fps, 124
frames, 8 steps). Completed shots require the `minimax-h3-worker/v1` receipt,
R2 byte/digest reconciliation, and opening-motion QA before their claims are
reused in a retry.

The reusable `renderEngineH3Contract` client can read the Render Engine's
project-authenticated `/client/h3-contract` endpoint when a server caller is
configured with `MINIMAX_H3_HYPER_EMERGENCY=1`,
`RENDER_ENGINE_CONVEX_SITE_URL`, and `RENDER_ENGINE_PROJECT_TOKEN`. It requires
the exact Studio profile, model manifest, first-frame and output buckets,
worker receipt schema, opening-motion QA, qualified Hyper runtime, and
paid-dispatch readiness. It sends the `youtube-studio` project capability over
GET; no operator token or deployment-wide worker secret is part of the
contract. The frozen batch builder and validator preserve per-shot request
identity, output identity, and cost ceiling.

The Render Engine currently stages a 5-second 864×480 project H3 request and
its Hyper qualified-profile catalog is empty. The proposed authenticated
contract must report `qualifiedHyper: false` and `paidDispatchEnabled: false`
until qualification; the engine has no
Studio-compatible terminal receipt bridge. Hyper paid dispatch is therefore
**not enabled** by this change. The capacity timeout still hands the frozen
order to Novita. No production Trigger task calls the readiness client yet,
and no readiness result is recorded as a render outcome.

To activate a Hyper fallback in a later change:

1. Qualify the exact 1344×768 image-to-video worker, immutable model pack,
   first-frame mount, GPU class, per-shot cost ceiling, and opening-motion QA
   on Render Engine. Publish the qualification receipt and truthful contract.
2. Add project-authenticated, idempotent batch submission and a terminal result
   API that returns the exact Studio worker receipt and output bytes/digest.
3. In Studio, reconcile the frozen request packet and existing successful or
   rejected per-shot claims before submission. Use the weekly order tag on
   every Trigger child, persist each verified shot create-only, and write the
   aggregate receipt last. Treat ambiguous submit outcomes as reconciliation,
   never as permission to send another paid request.
4. Run a non-paid contract test and an explicitly authorized paid proof before
   enabling the route at the Salad timeout. Keep the existing Novita fallback
   until the Hyper terminal path is fully verified.

No Trigger schedule, GPU, deployment, or paid request is changed here.
