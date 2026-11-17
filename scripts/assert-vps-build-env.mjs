// The browser URL is embedded at build time. Require an explicit VPS address
// so this build cannot silently inherit the legacy managed deployment.
const value = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
let endpoint;
try {
  endpoint = new URL(value ?? "");
} catch {
  throw new Error("VPS build requires an explicit valid NEXT_PUBLIC_CONVEX_URL");
}
if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
    /(^|\.)convex\.(cloud|site)$/i.test(endpoint.hostname)) {
  throw new Error("VPS build requires a self-hosted Convex URL without embedded credentials");
}
