# Derived Short music-source authority

## Reproduced gap

`shorts_spinoff` revalidated the parent's retained release evidence and current
YuE2 approval before transformation. Its independent Short certificate omitted
the parent's music-source receipt, and its separate local-upload verifier did
not recheck source authority. A revocation during cropping or review could be
missed before upload. The earlier music evaluation record's claim that Shorts
were necessarily held by missing bindings was incorrect and has been corrected.

## Repair

- Inherit the exact source receipt from the verified parent certificate, never
  the ambient artifact store. Seal it into the Short certificate; do not inherit
  the parent's visual or audio quality claims.
- Recheck permission before paid derivative review, before sealing the new
  certificate, after durable proof verification and immediately before upload.
- Compare the reloaded Short source receipt against the verified parent's
  receipt. Refuse omitted, substituted, or unexpectedly injected source claims.
- Recheck before the separately authorized optional crosspost. Revocation after
  a completed YouTube upload prevents crossposting but does not retract that
  completed upload. The existing nonfatal crosspost policy is unchanged.
- The existing parent check covers both YuE2 and historical sources. Extra
  checks are conditional on a verified YuE2 receipt; legacy Shorts add no RPCs.
  No new audio download, polling, generation, or schedule is introduced.

Source approval is not publishing approval. Existing channel publishing gates
and private-by-default upload behavior remain independent. No check provides
atomic cancellation of a transfer already in flight.

## Verification scope

`shortsYuE2SourceAuthority.test.ts` executes the real `shortsSpinoff.run` caller
with fixture media/quality/storage/connector boundaries and the real YuE2 query
transport. It checks successful receipt propagation despite a hostile ambient
store, all six authority checks, revocation at each boundary, removed/replaced
receipts, injection into legacy output, and unchanged legacy request count.
No provider, owner decision, or actual upload occurs. This is workflow evidence,
not rendered-media quality or production rollout.

The existing Short release wiring, actual authenticated Convex continuation
handlers against the in-memory database, and final-master certificate hashing
and tamper suites also pass. No thumbnail tests or generation are included.
TypeScript, scoped ESLint, and the Next production build pass after the final
test edit. The code graph is refreshed. Production is not promoted by this batch.
