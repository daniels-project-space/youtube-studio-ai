import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ENVELOPE_PREFIX = "enc:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decodeKey(raw: string, envName: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64url");
  if (key.byteLength !== 32) {
    throw new Error(`${envName} must encode exactly 32 random bytes`);
  }
  return key;
}

export function requireSecretKey(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} is not configured`);
  return decodeKey(raw, envName);
}

/** AES-256-GCM envelope. AAD binds a secret to its tenant/connector identity. */
export function encryptSecret(
  plaintext: string,
  options: { envName: string; aad: string },
): string {
  if (!plaintext) throw new Error("cannot encrypt an empty secret");
  if (!options.aad) throw new Error("secret envelope AAD is required");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    requireSecretKey(options.envName),
    iv,
  );
  cipher.setAAD(Buffer.from(options.aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(
  envelope: string,
  options: { envName: string; aad: string },
): string {
  const [marker, version, ivRaw, tagRaw, ciphertextRaw, ...extra] =
    envelope.split(":");
  if (
    marker !== "enc" ||
    version !== "v1" ||
    !ivRaw ||
    !tagRaw ||
    !ciphertextRaw ||
    extra.length > 0
  ) {
    throw new Error("unsupported or malformed secret envelope");
  }
  if (!options.aad) throw new Error("secret envelope AAD is required");

  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const ciphertext = Buffer.from(ciphertextRaw, "base64url");
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
    throw new Error("malformed secret envelope parameters");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    requireSecretKey(options.envName),
    iv,
  );
  decipher.setAAD(Buffer.from(options.aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function isSecretEnvelope(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}:`);
}
