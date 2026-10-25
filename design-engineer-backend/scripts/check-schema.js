// Probe expected columns via PostgREST. A missing column returns PGRST204
// (422/400) even when RLS hides rows. Never prints secrets.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

const expected = {
  profiles: ['id', 'email', 'name', 'created_at'],
  projects: ['id', 'user_id', 'name', 'repository', 'base_branch', 'created_at', 'updated_at'],
  github_connections: ['id', 'user_id', 'provider', 'login', 'access_token', 'refresh_token', 'expires_at', 'created_at', 'updated_at'],
  codex_accounts: ['id', 'user_id', 'email', 'credential_reference', 'created_at', 'updated_at'],
  codex_auth_sessions: ['device_code', 'user_id', 'status', 'error', 'expires_at', 'created_at', 'updated_at'],
  design_contexts: ['id', 'project_id', 'screen_name', 'content', 'created_at', 'updated_at'],
};

(async () => {
  for (const [table, cols] of Object.entries(expected)) {
    let tableOk = true;
    for (const col of cols) {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=${col}&limit=0`;
      const res = await fetch(url, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (!res.ok) {
        if (/Could not find the (table|column)/i.test(await res.text())) {
          tableOk = false;
          console.log(`${table}.${col}: MISSING`);
        }
      }
    }
    console.log(tableOk ? `${table}: all expected columns present` : `${table}: missing columns above -> re-run supabase/schema.sql`);
  }
})();