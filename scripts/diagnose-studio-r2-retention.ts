/** Read-only operator diagnostic. Never enables retention or mutates R2. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { parse as parseDotenv } from "dotenv";
import { listByService } from "../src/lib/vault";
import { assertYouTubeStudioR2Account } from "../src/lib/youtubeR2Account";
import { YOUTUBE_STUDIO_R2_BUCKET } from "../src/lib/r2AssetRetention";

type R2Credentials = Record<string, string>;
type DiagnosticError = { name?: string; $metadata?: { httpStatusCode?: number } };

export function classifyR2DiagnosticError(error: unknown): "authentication" | "permission" | "missing_object" | "network_or_provider" {
  const e = error as DiagnosticError | null;
  const status = e?.$metadata?.httpStatusCode;
  if (status === 401 || ["Unauthorized", "InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken"].includes(e?.name ?? "")) return "authentication";
  if (status === 403 || e?.name === "AccessDenied") return "permission";
  if (status === 404 || e?.name === "NoSuchKey" || e?.name === "NotFound") return "missing_object";
  return "network_or_provider";
}

function required(secrets: R2Credentials, key: string): string {
  const value = secrets[key]?.trim();
  if (!value) throw new Error(`vault is missing ${key}`);
  return value;
}

export async function diagnoseStudioR2Retention(args: {
  headKey: string;
  compareEnvFile?: string;
  secrets?: R2Credentials;
}): Promise<Record<string, unknown>> {
  // A caller may inject only freshly fetched Project Hub values through the
  // codex-vault-exec runner. Ordinary checkout .env files are never used as
  // the credential source, because they can hold revoked keys.
  const secrets = args.secrets ?? (process.env.STUDIO_R2_DIAGNOSTIC_VAULT_INJECTED === "1"
    ? process.env as R2Credentials
    : await listByService("cloudflare"));
  const accountId = required(secrets, "R2_ACCOUNT_ID");
  const endpoint = required(secrets, "R2_ENDPOINT");
  assertYouTubeStudioR2Account({ accountId, expectedAccountId: accountId, endpoint });
  const client = new S3Client({ region: "auto", endpoint, credentials: {
    accessKeyId: required(secrets, "R2_ACCESS_KEY_ID"),
    secretAccessKey: required(secrets, "R2_SECRET_ACCESS_KEY"),
  } });
  const report: Record<string, unknown> = { accountPinned: true,
    credentialSource: "project-hub/cloudflare" };
  if (args.compareEnvFile) {
    const old = parseDotenv(readFileSync(args.compareEnvFile));
    report.checkoutKeyDiffersFromVault = old.R2_ACCESS_KEY_ID !== secrets.R2_ACCESS_KEY_ID;
  }
  try {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: YOUTUBE_STUDIO_R2_BUCKET, Prefix: "owner/", MaxKeys: 1 }));
    report.list = { status: listed.$metadata.httpStatusCode, returned: listed.Contents?.length ?? 0 };
  } catch (error) {
    report.list = { classification: classifyR2DiagnosticError(error), status: (error as DiagnosticError)?.$metadata?.httpStatusCode };
  }
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: YOUTUBE_STUDIO_R2_BUCKET, Key: args.headKey }));
    report.head = { status: head.$metadata.httpStatusCode, exists: true };
  } catch (error) {
    report.head = { classification: classifyR2DiagnosticError(error), status: (error as DiagnosticError)?.$metadata?.httpStatusCode };
  } finally {
    client.destroy();
  }
  const token = required(secrets, "R2_API_TOKEN");
  for (const [name, suffix] of [["bucket", ""], ["lifecycle", "/lifecycle"]] as const) {
    try {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${YOUTUBE_STUDIO_R2_BUCKET}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const body = await response.json() as { success?: boolean; result?: { name?: string; jurisdiction?: string; rules?: unknown[] } };
      report[name] = response.ok && body.success
        ? name === "bucket" ? { status: response.status, name: body.result?.name, jurisdiction: body.result?.jurisdiction }
          : { status: response.status, rules: body.result?.rules ?? [] }
        : { status: response.status, classification: response.status === 401 ? "authentication" : response.status === 403 ? "permission" : "network_or_provider" };
    } catch {
      report[name] = { classification: "network_or_provider" };
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const headKey = process.argv[2] ?? "lustig-short/final_2k.mp4";
  const compareEnvFile = process.argv[3];
  diagnoseStudioR2Retention({ headKey, compareEnvFile }).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    const checks = [report.list, report.head, report.bucket, report.lifecycle] as Array<{ status?: number }>;
    if (checks.some((check) => check?.status !== 200)) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ classification: "configuration_or_vault", errorType: error instanceof Error ? error.name : "unknown" }));
    process.exitCode = 1;
  });
}
