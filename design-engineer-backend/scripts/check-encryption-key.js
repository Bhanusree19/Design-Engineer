// Diagnose ENCRYPTION_KEY mismatches without starting the server.
//
// Usage:
//   npm run check:key
//   npm run check:key -- '<iv>:<tag>:<data>'
//   npm run check:key -- '<iv>:<tag>:<data>' --show
//
// Copy one encrypted value from Supabase to test which key can read it:
//   select credential_reference
//   from public.codex_accounts
//   where user_id = '<uuid>';
//
//   select access_token_encrypted
//   from public.github_connections
//   where user_id = '<uuid>';
//
// This script never prints a plaintext credential unless you pass --show.

require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env'),
});

const { buildEncryptionKeys, decryptText } = require('../encryption');

const args = process.argv.slice(2);
const show = args.includes('--show');
const payload = args.find((arg) => arg !== '--show');

const { keys, primary } = buildEncryptionKeys(process.env);

console.log(
  `Primary key: ${primary.label}#${primary.fingerprint} (${primary.source})`
);
console.log('Decryption candidates:');
for (const key of keys) {
  console.log(`  ${key.label}#${key.fingerprint}`);
}

if (!payload) {
  console.log('\nPass an encrypted value to see which key decrypts it:');
  console.log("  npm run check:key -- '<iv>:<tag>:<data>'");
  console.log('\nWhere to copy it from (Supabase SQL editor):');
  console.log(
    "  select credential_reference from public.codex_accounts where user_id = '<uuid>';"
  );
  console.log(
    "  select access_token_encrypted from public.github_connections where user_id = '<uuid>';"
  );
  process.exit(0);
}

try {
  const result = decryptText(payload, keys);
  console.log(
    `\nDecrypted with: ${result.key.label}#${result.key.fingerprint}`
  );
  console.log(`Legacy key (not primary): ${result.legacy ? 'yes' : 'no'}`);
  console.log(`Plaintext length: ${result.value.length} characters`);

  if (show) {
    console.log('Plaintext:');
    console.log(result.value);
  } else {
    console.log('Plaintext hidden. Re-run with --show to print it.');
  }
} catch (error) {
  console.error(`\n${error.message}`);
  if (error.cause) {
    console.error(`Last cipher error: ${error.cause.message}`);
  }
  process.exitCode = 1;
}
