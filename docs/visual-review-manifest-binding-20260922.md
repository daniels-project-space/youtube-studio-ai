# Complete visual-review manifest binding

## Why this precedes loop-aware review

The previous durable release check bound master identity, manifest address and
reviewed-frame identities/bytes, but did not bind the complete manifest. Its
coverage gap, required-focus counts, frame-selection reasons and extra fields
could change without invalidating that projection. A future loop-repetition
coverage attestation must not inherit this gap.

Both actual release-receipt writers now include `evidence.manifestFingerprint`:
the shared `qa_visual` caller and the separately reviewed Short caller. It is a
domain-separated SHA-256 over canonical JSON for the complete persisted review
evidence. Object-key order and JSON formatting are intentionally immaterial;
array order and every JSON data field remain bound.

The existing release-receipt fingerprint includes this field. The existing
certificate seals that receipt fingerprint, so no duplicate field or provider
database migration is necessary. Both remote-object and local-upload release
verification use the shared durable checker, which compares the manifest
fingerprint before reading frame objects. No additional storage request is
introduced. Altering or removing the new fingerprint invalidates the receipt;
re-sealing a downgraded receipt does not match its existing certificate.

## Evidence

`visualReviewManifestBinding.test.ts` executes each production writer's actual
receipt-constructor expression with guarded inputs, then exercises the real
durable release reader against a controlled object store. It verifies original
evidence, formatting/key-order equivalence, and rejection of seven mutations:
coverage gap, missing focus count, focus windows, master duration, manifest
version, frame-selection reasons and an added future evidence object. Failures
occur after the two existing receipt/manifest reads, before any frame read.
Removal/re-sealing downgrade cases also reject.

This is transport/integrity evidence using synthetic master/frame identities,
not a full `qa_visual` invocation, a real provider review, or a claim that the
fixture imagery meets a quality bar. Historical receipts without this field
remain readable under their previous checks; they do not acquire a retroactive
complete-manifest attestation. The fingerprint protects evidence identity, not
the truth of a reviewer assessment.

## Remaining work

Loop-aware review still needs explicit scope/coverage semantics, inspection of
the unique intro/body material, exact-master packet proof binding and release
validation of that combination. This batch does not waive long-form coverage
or promote the eight-hour fixture to production. No GPU, thumbnail test or
generation, owner audition, channel migration or production deployment occurs
here.
