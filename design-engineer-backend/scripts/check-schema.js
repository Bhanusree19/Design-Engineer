require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

(async () => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const text = await res.text();
  console.log('status', res.status, 'content-type:', res.headers.get('content-type'));
  // print schema keys w/o dumping entire thing
  try {
    const spec = JSON.parse(text);
    const s = spec.components?.schemas || {};
    console.log('schema count:', Object.keys(s).length, 'names sample:', Object.keys(s).slice(0, 40).join(','));
  } catch {
    console.log('not json, first 300 chars:', text.slice(0, 300));
  }
})();