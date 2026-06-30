/* ------------------------------------------------------------------
   Monium runtime config — TEMPLATE.

   Copy this file to  js/config.js  and paste in your own Supabase
   values. js/config.js is gitignored, so your keys stay out of the repo
   and this example stays as the reference for anyone who clones it.

   Where to find the values:  Supabase dashboard → Settings → API
   ------------------------------------------------------------------ */
window.MONIUM_CONFIG = {
  // Project URL — looks like https://abcd1234.supabase.co  (NOT the dashboard URL)
  SUPABASE_URL: "YOUR_SUPABASE_URL",

  // Public client key — the "anon" / "publishable" key (sb_publishable_… or eyJ…).
  // Safe to ship in the browser; your data is protected by row-level security.
  SUPABASE_KEY: "YOUR_SUPABASE_KEY",
};
