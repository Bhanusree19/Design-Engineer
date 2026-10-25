// AES-256-GCM helpers and encryption-key resolution.
//
// ENCRYPTION_KEY is used to encrypt everything at rest in Supabase. Changing
// it makes every existing ciphertext unreadable, so this module supports:
//
//   1. ENCRYPTION_KEY            -> primary key, used for all new writes
//   2. ENCRYPTION_KEY_PREVIOUS   -> comma-separated old key(s), decrypt only
//   3. ENCRYPTION_KEY_OLD        -> alias for the above
//   4. the legacy implicit key   -> sha256(SUPABASE_URL|GITHUB_CLIENT_SECRET|PORT)
//
// Old-key candidates let the backend read (and lazily re-encrypt) rows written
// before a key rotation. Decryption is still authenticated: AES-GCM guarantees
// a wrong key simply fails, it can never return the wrong plaintext.

const crypto = require('crypto');

// Ports that have historically been used by local/backend deployments. The
// implicit fallback key includes PORT, so a row written on localhost:4000 is
// not readable on Render's :10000 without trying the old port.
const FALLBACK_PORTS = ['10000', '4000', '3000', '5000', '8000', '8080', '80', '443'];

function normalizeKeyMaterial(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

function keyFromMaterial(material) {
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    return Buffer.from(material, 'hex');
  }
  return crypto.createHash('sha256').update(material).digest();
}

function fingerprintKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function fallbackKey({ supabaseUrl, githubClientSecret, port }) {
  return crypto
    .createHash('sha256')
    .update(`${supabaseUrl}|${githubClientSecret}|${port}`)
    .digest();
}

function addCandidate(candidates, seen, label, key, source, explicit) {
  if (!Buffer.isBuffer(key) || key.length !== 32) return;
  const fingerprint = fingerprintKey(key);
  if (seen.has(fingerprint)) return;
  seen.add(fingerprint);
  candidates.push({ label, key, fingerprint, source, explicit: !!explicit });
}

function buildEncryptionKeys(env = process.env) {
  const candidates = [];
  const seen = new Set();
  const port = env.PORT || 4000;
  const explicitRaw = env.ENCRYPTION_KEY;
  const explicit = normalizeKeyMaterial(explicitRaw);

  if (explicit) {
    addCandidate(
      candidates,
      seen,
      'ENCRYPTION_KEY',
      keyFromMaterial(explicit),
      'ENCRYPTION_KEY',
      true
    );

    // If the deployed value contains quotes/whitespace, keep the unnormalized
    // variant as a decryption candidate too, in case the existing rows were
    // written before that value was cleaned up.
    if (explicitRaw !== explicit) {
      addCandidate(
        candidates,
        seen,
        'ENCRYPTION_KEY(raw)',
        keyFromMaterial(explicitRaw),
        'ENCRYPTION_KEY',
        false
      );
    }
  }

  for (const name of ['ENCRYPTION_KEY_PREVIOUS', 'ENCRYPTION_KEY_OLD']) {
    const list = normalizeKeyMaterial(env[name]);
    if (!list) continue;

    list
      .split(',')
      .map((value) => normalizeKeyMaterial(value))
      .filter(Boolean)
      .forEach((value, index) => {
        addCandidate(
          candidates,
          seen,
          `${name}[${index}]`,
          keyFromMaterial(value),
          name,
          false
        );
      });
  }

  // Legacy implicit key: sha256(`${SUPABASE_URL}|${GITHUB_CLIENT_SECRET}|${PORT}`).
  // Include URL variants and common ports so data written by an older local or
  // Render instance can still be read after deployment changes.
  const supabaseUrl = env.SUPABASE_URL;
  const githubClientSecret = env.GITHUB_CLIENT_SECRET;

  const urlVariants = [{ label: '', value: supabaseUrl }];
  if (supabaseUrl) {
    const withoutTrailingSlash = supabaseUrl.replace(/\/+$/, '');
    if (withoutTrailingSlash !== supabaseUrl) {
      urlVariants.push({ label: ', url=trimmed', value: withoutTrailingSlash });
    }
    if (!supabaseUrl.endsWith('/')) {
      urlVariants.push({ label: ', url=with-slash', value: `${supabaseUrl}/` });
    }
  }

  const ports = [];
  const addPort = (value) => {
    const text = String(value);
    if (!ports.includes(text)) ports.push(text);
  };
  addPort(port);
  FALLBACK_PORTS.forEach(addPort);

  for (const urlVariant of urlVariants) {
    for (const portVariant of ports) {
      addCandidate(
        candidates,
        seen,
        `fallback(port=${portVariant}${urlVariant.label})`,
        fallbackKey({
          supabaseUrl: urlVariant.value,
          githubClientSecret,
          port: portVariant,
        }),
        'fallback',
        false
      );
    }
  }

  // Guarantee a primary key even when no configuration is present, matching
  // the original resolveEncryptionKey() behaviour.
  if (candidates.length === 0) {
    addCandidate(
      candidates,
      seen,
      'fallback(no-config)',
      fallbackKey({ supabaseUrl, githubClientSecret, port }),
      'fallback',
      false
    );
  }

  return {
    keys: candidates,
    primaryKey: candidates[0].key,
    primary: candidates[0],
  };
}

function encryptText(plainText, key) {
  if (plainText === null || plainText === undefined) return null;
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('A 32-byte encryption key is required');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

function parsePayload(payload) {
  const parts = String(payload).split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Malformed encrypted payload');
  }
  return {
    iv: Buffer.from(parts[0], 'base64'),
    tag: Buffer.from(parts[1], 'base64'),
    data: Buffer.from(parts[2], 'base64'),
  };
}

// Returns { value, key, legacy }. `legacy` is true when a non-primary key was
// needed, which means the row should be re-encrypted when possible.
function decryptText(payload, keys) {
  if (!payload) return null;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('No encryption keys are configured');
  }

  const { iv, tag, data } = parsePayload(payload);
  let lastError;

  for (const candidate of keys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', candidate.key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([
        decipher.update(data),
        decipher.final(),
      ]);

      return {
        value: decrypted.toString('utf8'),
        key: candidate,
        legacy: candidate !== keys[0],
      };
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(
    `Unable to decrypt payload with any configured key (${keys
      .map((candidate) => `${candidate.label}#${candidate.fingerprint}`)
      .join(', ')}).`
  );
  error.cause = lastError;
  throw error;
}

module.exports = {
  buildEncryptionKeys,
  decryptText,
  encryptText,
  fingerprintKey,
  keyFromMaterial,
  normalizeKeyMaterial,
};
