# DocuMotion Pinned Fonts

Unmodified WOFF2 files selected by `@remotion/google-fonts` 4.0.506:
Anton v27 (400, Vietnamese/Latin extended/Latin), Oswald v57 (500/600/700,
Latin), Caveat v23 (600/700, Latin), Special Elite v20 (400, Latin).
Oswald and Caveat reuse their original variable-font bytes across weights.

`manifest.json` records immutable source URLs, byte lengths, SHA-256 digests,
and the Google Fonts repository revision for accompanying licenses.
Anton, Oswald and Caveat use the included SIL Open Font License texts.
Special Elite uses the included Apache 2.0 license.

Run `node scripts/vendor-documotion-fonts.mjs` from the repository root to
reacquire the files. Existing receipts reject changed source bytes. This script
is a maintenance tool, never a build step or runtime network dependency.

DocuMotion uses Remotion's native loader with local static-file URLs, retaining
the original family names, weights, Unicode ranges and font-readiness lifecycle.
A dependency upgrade selecting an unvendored URL fails explicitly instead of
silently falling back to a different font or contacting the CDN.
