# KLUST Shuttle — Vercel deployment

## What's in here
```
index.html      the whole app (static)
sw.js           on-device map-tile cache (service worker)
api/login.js    the KLUST login relay, as a Vercel serverless function (Node.js runtime)
package.json    pins Node 20.x for the function (for a complete fetch/cookie implementation)
```

Note: this originally used Vercel's Edge Runtime, which some institutional
servers (KLUST included) don't complete a network handshake with reliably —
that showed up as "Could not reach KLUST LMS" even though the relay itself
was running fine. It's now a plain Node.js function instead.

That surfaced a second, more specific issue: KLUST's server doesn't send
its full TLS certificate chain (a missing intermediate certificate), which
Node's strict verification rejects (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) even
though browsers tolerate it (your OS fetches the missing certificate
automatically; Node doesn't). `api/login.js` now relaxes certificate
verification *specifically* for connections to `lms.klust.edu.my`, via the
`undici` package (listed in `package.json` — Vercel installs it
automatically on deploy). Every other request this relay could make still
verifies normally; this is scoped narrowly, not a blanket "trust
everything" setting.

## Deploy (first time)
1. Push this folder to a GitHub repo (or drag-and-drop the folder straight into Vercel's "Import" screen — a repo isn't required).
2. Go to vercel.com → **Add New → Project** → import it.
3. Framework preset: choose **Other**. No build command, no output directory — leave both blank. Click **Deploy**.
4. That's it. Your app is live at `https://<your-project>.vercel.app`, and `/api/login` already works — `index.html` calls it as a relative path (`/api/login`), so there's no URL to copy-paste this time.

## Optional: environment variables
None are required. If you want them, add these under **Project → Settings → Environment Variables**, then redeploy:

| Variable | What it does |
|---|---|
| `KLUST_ORIGIN` | Override the LMS base URL. Default: `https://lms.klust.edu.my` |
| `ALLOWED_ORIGIN` | Restrict CORS to one origin (e.g. `https://your-project.vercel.app`) instead of `*` |
| `RELAY_SECRET` | A shared secret. If set, `/api/login` rejects any request that doesn't send it back in an `X-Relay-Secret` header. |

If you set `RELAY_SECRET`, also open `index.html`, find:
```js
const KLUST_RELAY_SECRET = '';
```
and paste the same value in, then redeploy. **Be clear-eyed about what this does and doesn't protect**: it's a basic filter against random bots hitting your relay, not real secrecy — anyone who views your page's source can read the same value out of `KLUST_RELAY_SECRET`. Real protection against abuse would mean server-side rate limiting (e.g. Vercel KV or Upstash), which isn't included here.

## Updating later
Push a new commit (or re-drag the folder) — Vercel redeploys automatically. No env vars needed to change unless you're adding/editing the ones above.

## Using a non-Vercel relay instead (e.g. Cloudflare Workers)
Deployed `api/login.js`'s logic elsewhere on its own domain? Open `index.html`, find:
```js
const KLUST_RELAY_URL = '/api/login';
```
and replace it with the absolute URL of that deployment instead.

## Timetable parsing
`api/login.js` reads KLUST's timetable grid (30-minute columns). Each class's
width comes from its `colspan` (written as `colspan="6"`, `colspan=6` or
`colspan='6'` depending on the server), and slot-to-time mapping is read from the
grid's own header row (`08:00 AM`, `08:30 AM`, ...), not assumed. If the width
were misread, every class after the first of the day would show too early.
After deploying, **sign out and sign in again** so the app re-pulls the timetable
(it is stored on the device from the last sign-in).
