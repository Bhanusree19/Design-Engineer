'use strict';
// Who counts as an admin (the owner's account). Admins see the full design
// fidelity report; every other account sees only the build preview. Decided
// on the server from the verified sign-in, never by the plugin.
//
//   ADMIN_EMAILS=you@example.com,other@example.com
//   ADMIN_USER_IDS=<supabase user uuid>   (optional, survives an email change)

function list(name, lower = true) {
  return String(process.env[name] || '').split(',').map((v) => v.trim()).filter(Boolean).map((v) => (lower ? v.toLowerCase() : v));
}

function isAdmin(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.id && list('ADMIN_USER_IDS', false).includes(user.id)) return true;
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  return !!email && list('ADMIN_EMAILS').includes(email);
}

module.exports = { isAdmin };
