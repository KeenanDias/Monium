/* ------------------------------------------------------------------
   Shared Monium backend.

   A thin wrapper around the Supabase client so the signup logic lives
   in ONE place and is reused by both the landing page and the live app.
   Reads its keys from window.MONIUM_CONFIG (js/config.js).

   Load order on every page:
     1) @supabase/supabase-js (CDN)
     2) js/config.js
     3) js/supabase.js   <-- this file
   ------------------------------------------------------------------ */
(function () {
  var cfg = window.MONIUM_CONFIG || {};
  var looksReal = function (v) {
    return typeof v === "string" && v.length > 8 && !/YOUR|PASTE/i.test(v);
  };
  var configured = !!(window.supabase && looksReal(cfg.SUPABASE_URL) && looksReal(cfg.SUPABASE_KEY));
  var client = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY) : null;

  if (!configured) {
    console.warn("[Monium] Supabase not configured — set your keys in js/config.js to save signups.");
  }

  /* Insert a beta signup. Throws { code: 'NO_CONFIG' } if keys are missing,
     and silently treats a duplicate email (23505) as success. */
  async function saveSignup(name, email) {
    if (!client) {
      var e = new Error("Supabase not configured");
      e.code = "NO_CONFIG";
      throw e;
    }
    var res = await client.from("beta_signups").insert({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
    });
    if (res.error && res.error.code !== "23505") throw res.error;
  }

  window.MoniumBackend = { client: client, ready: configured, saveSignup: saveSignup };
})();
