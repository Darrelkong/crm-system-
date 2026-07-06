import { eq, isNotNull, or, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Database } from "@/lib/db";

// ---------------------------------------------------------------------------
// DB key constants — never added to SETTING_KEYS so they never appear in the
// generic settings GET/PATCH API and cannot be modified through that endpoint.
// ---------------------------------------------------------------------------
const KEY_ENABLED = "secondary_idle_code_enabled";
const KEY_HASH = "secondary_idle_code_hash";
const KEY_GENERATED_AT = "secondary_idle_code_generated_at";

export const IDLE_EXEMPT_DURATION_MS = 8 * 60 * 60 * 1000;
export const IDLE_EXEMPT_MAX_ATTEMPTS = 5;
export const IDLE_EXEMPT_LOCKOUT_MINUTES = 30;

// ---------------------------------------------------------------------------
// Charset for code generation
// ---------------------------------------------------------------------------
const CHARSET_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHARSET_LOWER = "abcdefghijklmnopqrstuvwxyz";
const CHARSET_DIGIT = "0123456789";
const CHARSET_ALL = CHARSET_UPPER + CHARSET_LOWER + CHARSET_DIGIT;

export type SecondaryIdleCodeState = {
  enabled: boolean;
  hasCode: boolean;
  generatedAt: string | null;
};

// ---------------------------------------------------------------------------
// Code generation (pure, no side effects)
// ---------------------------------------------------------------------------

/** Pick one random character from charset using rejection sampling. */
function pickChar(charset: string): string {
  const max = charset.length;
  const limit = 256 - (256 % max);
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return charset[buf[0] % max];
    }
  }
}

/** Fisher-Yates shuffle using crypto-secure random. */
function shuffleChars(arr: string[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const maxJ = i + 1;
    const limit = 256 - (256 % maxJ);
    const buf = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < limit) {
        const j = buf[0] % maxJ;
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
        break;
      }
    }
  }
}

/**
 * Generate an 8-character one-time code containing at least one digit,
 * one uppercase letter, and one lowercase letter. Uses crypto.getRandomValues
 * with rejection sampling to eliminate modulo bias.
 */
export function generateSecondaryIdleCode(): string {
  const chars: string[] = [
    pickChar(CHARSET_DIGIT),
    pickChar(CHARSET_UPPER),
    pickChar(CHARSET_LOWER),
    pickChar(CHARSET_ALL),
    pickChar(CHARSET_ALL),
    pickChar(CHARSET_ALL),
    pickChar(CHARSET_ALL),
    pickChar(CHARSET_ALL),
  ];
  shuffleChars(chars);
  return chars.join("");
}

// ---------------------------------------------------------------------------
// PBKDF2 hashing (no Node.js crypto — uses Web Crypto only)
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Constant-time string comparison to prevent timing side-channels. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Hash a code with PBKDF2-SHA256 (100,000 iterations).
 * Stored format: `{saltHex}:{hashHex}`
 */
export async function hashSecondaryIdleCode(code: string): Promise<string> {
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return `${toHex(salt)}:${toHex(new Uint8Array(derivedBits))}`;
}

/**
 * Verify a plaintext code against a stored hash string.
 * Returns false for any malformed or empty stored value.
 */
export async function verifySecondaryIdleCode(
  code: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash || !storedHash.includes(":")) return false;
  const colonIdx = storedHash.indexOf(":");
  const saltHex = storedHash.slice(0, colonIdx);
  const expectedHex = storedHash.slice(colonIdx + 1);
  if (!saltHex || !expectedHex) return false;

  let salt: Uint8Array<ArrayBuffer>;
  try {
    salt = fromHex(saltHex);
  } catch {
    return false;
  }

  let keyMaterial: CryptoKey;
  try {
    keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(code),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
  } catch {
    return false;
  }

  let derivedBits: ArrayBuffer;
  try {
    derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      keyMaterial,
      256,
    );
  } catch {
    return false;
  }

  const computedHex = toHex(new Uint8Array(derivedBits));
  return constantTimeEqual(computedHex, expectedHex);
}

// ---------------------------------------------------------------------------
// DB helpers — raw access to system_settings for the secondary-idle-code keys
// ---------------------------------------------------------------------------

async function readSetting(db: Database, key: string): Promise<string> {
  const rows = await db
    .select({ value: schema.systemSettings.value })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);
  return rows[0]?.value ?? "";
}

async function writeSetting(
  db: Database,
  key: string,
  value: string,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db
    .select({ key: schema.systemSettings.key })
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, key))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.systemSettings)
      .set({ value, updatedAt: now })
      .where(eq(schema.systemSettings.key, key));
  } else {
    await db.insert(schema.systemSettings).values({
      key,
      value,
      updatedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Public DB operations
// ---------------------------------------------------------------------------

/**
 * Read the current state of the secondary idle-code feature.
 * Never returns the hash or plaintext.
 */
export async function getSecondaryIdleCodeState(
  db?: Database,
): Promise<SecondaryIdleCodeState> {
  const database = db ?? getDb();
  const enabled = await readSetting(database, KEY_ENABLED);
  const hash = await readSetting(database, KEY_HASH);
  const generatedAt = await readSetting(database, KEY_GENERATED_AT);
  return {
    enabled: enabled === "true",
    hasCode: hash !== "",
    generatedAt: generatedAt || null,
  };
}

/**
 * Generate a new code, store its hash, enable the feature.
 * Returns the plaintext code — must be shown to the admin exactly once.
 * The plaintext is never logged or persisted.
 */
export async function generateAndStoreCode(db?: Database): Promise<string> {
  const database = db ?? getDb();
  const plaintext = generateSecondaryIdleCode();
  const hash = await hashSecondaryIdleCode(plaintext);
  const now = new Date().toISOString();

  await writeSetting(database, KEY_ENABLED, "true");
  await writeSetting(database, KEY_HASH, hash);
  await writeSetting(database, KEY_GENERATED_AT, now);

  return plaintext;
}

/**
 * Rotate the code after successful use: generate a new hash and store it,
 * update generated_at. Does NOT return the new plaintext.
 */
export async function rotateCodeAfterUse(db?: Database): Promise<void> {
  const database = db ?? getDb();
  const newPlaintext = generateSecondaryIdleCode();
  const newHash = await hashSecondaryIdleCode(newPlaintext);
  const now = new Date().toISOString();

  await writeSetting(database, KEY_HASH, newHash);
  await writeSetting(database, KEY_GENERATED_AT, now);
  // plaintext is intentionally discarded here — Admin must call generate to see a new code
}

/**
 * Disable the secondary idle-code feature.
 * Immediately clears all active idle exemptions on all sessions.
 * Clears the stored hash and generated_at to avoid stale state.
 */
export async function disableSecondaryIdleCode(db?: Database): Promise<void> {
  const database = db ?? getDb();

  await writeSetting(database, KEY_ENABLED, "false");
  await writeSetting(database, KEY_HASH, "");
  // Clear generated_at: when disabled there is no active code, so keeping a
  // "last generated" timestamp would be misleading.
  await writeSetting(database, KEY_GENERATED_AT, "");

  // Immediately invalidate all active idle exemptions on all sessions.
  await database
    .update(schema.sessions)
    .set({
      idleExemptUntil: null,
      idleExemptAttempts: 0,
      idleExemptLockedUntil: null,
    })
    .where(
      or(
        isNotNull(schema.sessions.idleExemptUntil),
        gt(schema.sessions.idleExemptAttempts, 0),
        isNotNull(schema.sessions.idleExemptLockedUntil),
      ),
    );
}

/**
 * Get only the stored hash for verification purposes.
 * Returns empty string if not set.
 */
export async function getStoredHash(db?: Database): Promise<string> {
  const database = db ?? getDb();
  return readSetting(database, KEY_HASH);
}
