# Monium PWA — Build & Ship Guide

**Goal:** Monium running on your iPhone home screen, showing a real safe-to-spend
number from your real bank data. No Mac, no App Store, no Apple Developer account.

**What already exists:** a complete React UI prototype (`app.html`) and a working
AWS backend (four Lambdas behind API Gateway). This guide connects them and makes
the result installable.

---

## 0. The shape of the work

| Layer | Status | What's needed |
|---|---|---|
| UI (`app.html`) | Built, running on hardcoded constants | Replace constants with API calls |
| Backend (AWS) | Deployed and tested | Add CORS; add Plaid token exchange |
| Auth | Supabase wired for beta signup only | Decide one system, use it everywhere |
| Bank connection | Mock screen | Real Plaid Link (web SDK) |
| Installable | Not yet | Manifest, service worker, icons, meta tags |

The UI is the part that usually takes longest, and it's already done. Most of the
remaining work is plumbing.

---

## 1. Decisions to make first

### 1.1 Auth: AWS `monium-auth`

The stack is AWS end to end. Auth uses the `monium-auth` Lambda (bcrypt + JWT,
deployed and tested), not Supabase.

Supabase stays only where it already is — the beta-signup form on the landing page.
It never touches the app, and there is only ever one user table: `MoniumUsers` in
DynamoDB.

**The flow:**

1. `POST /auth` with `{ email, password, action: "register" | "login" }`
2. Response returns `{ userId, email, token }`
3. Store `userId` and `token` in `localStorage`
4. Send `Authorization: Bearer <token>` on every subsequent call
5. On `401`, clear storage and return to the login screen

**Three things this owes you that don't exist yet.** None block launch; all are
real work:

- **No password reset.** A user who forgets their password is locked out
  permanently. Build a reset flow (SES for the email) or accept it during beta.
- **No email verification.** Anyone can register with any address.
- **No MFA.** You told Plaid you'd add MFA before production launch.

**Worth knowing:** AWS Cognito is the native answer to all three and keeps you
entirely inside AWS — it's a managed service in the same console, alongside IAM.
Configuration rather than code, and it would let you delete `lambda/auth`. Not a
launch-day change, but it's the AWS-native path to the MFA and reset flows rather
than hand-rolling them.

### 1.2 Where it's hosted

**Cloudflare Pages** — your repo already has a `cloudflare/workers-autoconfig`
branch, so the account likely exists. Free, HTTPS included, deploys on push to
`main`.

GitHub Pages works too. Either is fine. **HTTPS is non-negotiable** — Plaid Link
refuses to load over plain HTTP, and PWAs require it to be installable.

### 1.3 Get the repo locally

Your laptop currently only has `MoniumApp/` (the backend). `app.html` lives in the
GitHub repo. Clone it so you can edit the frontend:

```powershell
cd c:\Users\diask\Desktop\funsies\monium
git clone https://github.com/KeenanDias/Monium.git Monium-web
```

---

## 2. Backend: two changes

### 2.1 Enable CORS on API Gateway

A native app can call your API freely. A browser cannot — it first sends a
"preflight" `OPTIONS` request asking permission, and blocks everything if the
answer is missing. Without this, **every** call from `app.html` fails.

For each of the four resources (`/auth`, `/kyc`, `/plaid`,
`/process-transactions`), you need an `OPTIONS` method returning:

```
Access-Control-Allow-Origin: https://<your-domain>
Access-Control-Allow-Headers: Content-Type,Authorization
Access-Control-Allow-Methods: OPTIONS,POST
```

And your Lambdas must return `Access-Control-Allow-Origin` on their real responses
too, since they use `AWS_PROXY` integration (API Gateway doesn't add headers for
you in proxy mode). Add to every `return` in every handler:

```js
headers: {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://<your-domain>'
}
```

Use your actual domain, not `*`. `*` means any website on the internet can call
your API from a victim's browser.

### 2.2 Add the Plaid token exchange endpoint

Plaid hands the browser a short-lived `public_token`. That must be swapped
server-side for a long-lived `access_token`, which never touches the client.

New Lambda `monium-plaid-exchange` (`lambda/plaid-exchange/index.js`):

1. Receives `{ userId, publicToken }`
2. Calls Plaid `/item/public_token/exchange`
3. Stores `access_token` on the user's DynamoDB row
4. Returns `{ success: true }` — **never the token**

Then `/process-transactions` reads the token from DynamoDB instead of accepting it
from the request body.

---

## 3. Frontend: wiring the prototype to real data

### 3.1 Add an API client

New file `js/api.js`, loaded after `js/config.js`:

```js
window.MONIUM_API = (function () {
  const BASE = "https://z2t5gxylo8.execute-api.us-east-1.amazonaws.com/prod";
  const KEY = "monium.session";

  const session = {
    get:   () => JSON.parse(localStorage.getItem(KEY) || "null"),
    set:   (s) => localStorage.setItem(KEY, JSON.stringify(s)),
    clear: () => localStorage.removeItem(KEY)
  };

  async function post(path, body, auth = true) {
    const s = session.get();

    const res = await fetch(BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth && s ? { Authorization: "Bearer " + s.token } : {})
      },
      body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => ({}));

    // Token expired (24h) - force a fresh login
    if (res.status === 401) {
      session.clear();
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function authenticate(email, password, action) {
    const r = await post("/auth", { email, password, action }, false);
    session.set({ userId: r.userId, email: r.email, token: r.token });
    return r;
  }

  return {
    session,
    register: (e, p) => authenticate(e, p, "register"),
    login:    (e, p) => authenticate(e, p, "login"),
    logout:   () => session.clear(),

    // userId comes from the stored session, never from the UI
    saveProfile: (p)  => post("/kyc", { ...p, userId: session.get().userId }),
    linkToken:   ()   => post("/plaid", { userId: session.get().userId }),
    exchange:    (pt) => post("/plaid-exchange", { userId: session.get().userId, publicToken: pt }),
    refresh:     ()   => post("/process-transactions", { userId: session.get().userId })
  };
})();
```

**On `localStorage`:** the token sits there in plain text, readable by any script
running on your page. That's the standard trade-off for browser apps, and it's
acceptable because you control every script — but it's the reason the 24-hour
expiry in `generateToken()` matters, and the reason not to add third-party
analytics or ad scripts to this page.

### 3.2 Replace the hardcoded model

In `app.html`, these are currently constants around line 95:

```js
const INCOME = 3000, FIXED = 1200, BUFFER = 75, ESCROW = 0, DAYS_LEFT = 30;
const FIXED_ITEMS = [ /* Rent, Gym, Spotify */ ];
```

They become state loaded from `/process-transactions`, which returns exactly these
shapes:

| Prototype constant | Comes from |
|---|---|
| `INCOME` | `monthlyIncome` |
| `FIXED` | `monthlyCommitted` |
| `FIXED_ITEMS` | `commitments[]` — each has `name`, `category`, `frequency`, `monthlyAmount` |
| `DAYS_LEFT` | `daysUntilNextPayday` |
| the daily number | `safeToSpendDaily` |
| category breakdown | `categoryBreakdown` |

The response was designed against this UI, so it's close to a drop-in. `commitments[]`
maps directly onto the Review screen and the `FIXED_ITEMS` list.

Keep `dailyFromBite()` as-is — goal escrow is still a client-side subtraction from
the server's number.

### 3.3 Real Plaid Link

Add to `<head>`:

```html
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
```

Then `ScreenConnect` opens real Link:

```js
async function connectBank(userId, onDone) {
  const { link_token } = await window.MONIUM_API.linkToken(userId);

  const handler = Plaid.create({
    token: link_token,
    onSuccess: async (publicToken) => {
      await window.MONIUM_API.exchange(userId, publicToken);
      const result = await window.MONIUM_API.refresh(userId);
      onDone(result);
    },
    onExit: (err) => { if (err) console.error("Plaid exit:", err); }
  });

  handler.open();
}
```

**Sandbox test credentials:** username `user_good`, password `pass_good`, and any
value for MFA. Pick any bank.

### 3.4 Remove the dev scaffolding

[app.html:36-39](app.html#L36-L39) gates a stepper and "Reset demo" behind a
`localhost` check. On a real domain these hide themselves automatically — but
verify, because a visible "Reset demo" button on launch day looks unfinished.

The `StatusBar` component (fake "9:41" and battery icons) should go once this runs
full-screen on a real phone — iOS draws the real status bar above your app, so
you'd have two.

---

## 4. Making it installable

### 4.1 `manifest.json` (repo root)

```json
{
  "name": "Monium",
  "short_name": "Monium",
  "start_url": "/app.html",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#111111",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`"display": "standalone"` is what removes the Safari address bar.

### 4.2 Meta tags in `app.html` `<head>`

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#111111" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Monium" />
<link rel="apple-touch-icon" href="/icons/icon-180.png" />
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
```

iOS ignores `manifest.json` icons for the home screen — it uses
`apple-touch-icon`. You need **both**.

`viewport-fit=cover` lets the app fill the screen around the notch. Pair it with
`padding: env(safe-area-inset-bottom)` on your bottom nav so it clears the home
indicator.

### 4.3 Icons

Three PNGs in `/icons/`: **180×180** (`icon-180.png`), **192×192**, **512×512**.
Your existing `Mark` component — white serif "M" on a near-black circle — is the
design. Export it on a solid square background; iOS applies its own rounded corners
and a transparent background will render black.

### 4.4 Service worker (`sw.js`, repo root)

Required for installability. Keep it minimal — an over-eager cache means users see
stale code after you deploy.

```js
const CACHE = "monium-v1";
const SHELL = ["/app.html", "/css/app.css", "/js/config.js", "/js/supabase.js", "/js/api.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Never cache API calls - financial data must always be live
  if (e.request.url.includes("execute-api") || e.request.url.includes("supabase")) return;

  // Network-first for everything else, cache as offline fallback
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
```

Register it at the bottom of `app.html`:

```html
<script>
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }
</script>
```

Bump `CACHE` to `monium-v2` whenever you deploy a change, or users keep the old
version.

### 4.5 Install it

On your iPhone, in **Safari** (not Chrome — only Safari can install PWAs on iOS):
open the site → Share → **Add to Home Screen**.

---

## 5. Ship checklist

- [ ] Repo cloned locally; frontend editable
- [ ] CORS enabled on all four API Gateway resources
- [ ] `Access-Control-Allow-Origin` returned by every Lambda response
- [ ] `monium-plaid-exchange` deployed
- [ ] `/process-transactions` reads the access token from DynamoDB, not the request
- [ ] `js/api.js` added and loaded
- [ ] Hardcoded constants in `app.html` replaced with API state
- [ ] Plaid Link opens and `user_good` / `pass_good` completes
- [ ] Dashboard shows a number derived from sandbox data
- [ ] `manifest.json`, `sw.js`, icons in place
- [ ] Deployed to HTTPS
- [ ] Installed to home screen, launches without Safari chrome

---

## 6. Known gaps to close after launch

**No authorization on the API.** Every endpoint is `authorization-type NONE`.
Anyone who knows a `userId` can overwrite that person's profile. The fix is a Lambda
authorizer that verifies the `monium-auth` JWT — recompute the HMAC-SHA256
signature with `JWT_SECRET` from Secrets Manager, check `exp`, then reject any
request whose token `userId` doesn't match the `userId` in the body.
**Do this before anyone but you uses the app.**

Note the current token also uses plain base64 rather than base64url, so it isn't a
spec-compliant JWT. It verifies fine against your own authorizer, but no standard
JWT library will parse it. Worth fixing when you build the authorizer, since you'll
be touching the same code.

**Partial-history distortion.** `monthlySpendByCategory()` divides a 90-day window
by ~3 months. A user whose bank returns two weeks of history gets their spending
inflated roughly 6×. Scale by the actual span of returned transactions instead.

**Goal parsing.** `parseFloat(profile.goal)` returns `NaN` for `"$5,000"`, which
silently makes the savings target 0. Use the prototype's own `parseAmount()` helper,
which already handles currency strings.

**In-browser Babel.** `app.html` compiles JSX in the browser on every load — fine
for a prototype, noticeably slow on mobile. A build step (Vite) is the eventual
fix, not a launch-day one.

**React development builds.** The CDN links load `react.development.js`. Switch to
`react.production.min.js` — smaller and faster, one-line change.

---

## 7. Why this beats the native path

| | PWA | React Native + EAS |
|---|---|---|
| Mac required | No | No (cloud builds) |
| Apple Developer account | No | **$99/year** |
| Time to phone | Minutes | Hours per build cycle |
| App Store listing | No | Yes |
| Reuses `app.html` | **Entirely** | Rewrite the UI |

The backend, the Plaid integration, and all the safe-to-spend logic carry over
unchanged if you later go native. Only the UI layer would be rewritten. Ship the
PWA as the beta; treat native as the funded version.
