# Monium

A calm, black-and-white personal-finance landing page **+** an interactive "Safe-to-Spend" app demo. Plain HTML/CSS/JS with React (via CDN) for the app — **no build step required**. Beta signups are stored in **Supabase**.

## Project layout

```
.
├─ index.html            # Landing page (marketing + beta signup)
├─ app.html              # The live Monium app demo (embedded by the landing via <iframe>)
├─ css/
│  ├─ landing.css        # Landing-page styles
│  └─ app.css            # App shell styles (Tailwind via CDN handles the rest)
├─ js/
│  ├─ config.example.js  # Config TEMPLATE (committed)
│  ├─ config.js          # Your real Supabase keys (GITIGNORED — you create this)
│  ├─ supabase.js        # Shared backend: Supabase client + saveSignup() helper
│  └─ landing.js         # Landing interactions (nav, reveal-on-scroll, signup)
├─ supabase/
│  └─ schema.sql         # Database table + row-level-security policy
├─ docs/
│  └─ handoff.md         # Original product/handoff notes
├─ .env.example          # Documented env values (real runtime config is js/config.js)
├─ .gitignore            # Ignores js/config.js and .env
└─ README.md
```

### How the pieces fit

- **`index.html`** is the front door. It loads `css/landing.css` and, at the end, `js/config.js → js/supabase.js → js/landing.js` (order matters).
- It embeds **`app.html?embed=1`** in an `<iframe>`, so the live phone demo appears inside the landing page. The iframe isolates the app's Tailwind from the landing page's CSS.
- **`app.html`** is the React app. The component source is inline (compiled in-browser by Babel) but it reuses the **same** `js/config.js` + `js/supabase.js` as the landing — signup logic lives in one place (`window.MoniumBackend.saveSignup`).
- The app's dev tools (Connect/Review/Live stepper, Reset, Join Beta) only show on `localhost`/`file://`. On a real domain or inside the embed, you just get the clean phone.

## Setup

1. **Create a Supabase project** at https://supabase.com.
2. **Create the table** — Supabase → SQL Editor → New query → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
3. **Add your keys** — copy the template and fill it in:
   ```bash
   cp js/config.example.js js/config.js
   ```
   Then edit `js/config.js` with your **Project URL** and **anon/publishable key** (Supabase → Settings → API). `js/config.js` is gitignored, so your keys never get committed.

## Run it

It's a static site, so just open **`index.html`** in a browser (double-click works), or serve it for a closer-to-production experience:

```bash
npx serve .
# or use the VS Code "Live Server" extension
```

## Deploy

Push to GitHub and point any static host at the repo root (GitHub Pages, Netlify, Vercel, Cloudflare Pages). `index.html` is the entry point.

> Because `js/config.js` is gitignored, set your keys on the host too — either commit a deploy-only config, or add a build step that writes `js/config.js` from environment variables. The Supabase **anon/publishable key is safe to expose** in the browser; your data is protected by the row-level-security policy in `schema.sql`. Never put the `service_role` (secret) key in this front-end.

## Notes

- No frameworks/bundler — React, Tailwind, Babel and supabase-js all load from CDNs.
- To upgrade to a real build pipeline later (Vite + React components + `.env`), the structure already separates config, styling, and logic, so it ports cleanly.
