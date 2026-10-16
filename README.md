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

---

## What's new in this version

**1. Closest stop from your current location** (student)
- *Home*: tap **Find my nearest stop**. Also available as **Use my current location** inside the stop picker (Home, Account → My stop) and at the top of **Book**.
- Stops are sorted nearest-first with distance and walking time, the closest one is suggested with its next shuttle, and a blue "you are here" dot appears on the map.
- On Book it also picks the soonest bookable departure from that stop; **Use this stop and departure** fills in the route, stop and time.
- Privacy: location is read only when the button is tapped, kept in memory only (never written to storage, never sent anywhere). Needs HTTPS (Vercel is fine) and the browser's permission; denied/timeout/unsupported cases show a friendly message and the manual list still works.

**2. Suggested trip goes straight to payment**
- *Suggested for you* (from the LMS timetable) now finds the **latest shuttle that still reaches class** (8 min walk + 4 min buffer), built from the real bookable timetable.
- **Reserve and pay** holds a seat automatically and opens the **Payment** step directly (a 5-minute hold, same as the normal flow). **Change** next to the seat returns to seat selection.
- If the boarding stop equals the class stop, the card asks for your starting point and offers *Use my location*.

**3. Payment options managed by admin** (Admin → **Payments**)
- Switch any option on/off, remove it, add it back, add ready-made ones (Touch 'n Go eWallet, Boost, GrabPay, ShopeePay, FPX) or create your own, and reorder them.
- At least one option must stay on. Students only ever see enabled options (checked again at the moment of paying).
- Per-option booking count, money collected and cash still due. Removing an option never breaks old bookings (they keep their label).
- Cash-specific wording (login screen, privacy note) hides itself when Cash is off.

**4. Stop tracking is no longer one-way**
- *Stop tracking* now **pauses**. A green **Resume live tracking** banner stays on Home while the ride is still running, and tapping your vehicle on the map also resumes. **I have got off, end this ride** ends it for good, and it ends automatically once the vehicle is back at the hub.

**Extras**
- **Student demo login**: username `demo`, password `123` on the Student tab signs in as *Demo Student* with a sample timetable and no LMS needed (handy for marking/demos). Driver/Admin use the same demo/123.
- Existing saved browser data is migrated automatically; nothing needs to be reset.

---

## KLUST Plus (presentation build) - `plus.js`

Loaded at the bottom of `index.html`; everything below lives in `plus.js` (plus an app-shell cache in `sw.js`).

| Feature | Where |
|---|---|
| **My location** button under +, -, centre on every map. Boarded riders: your dot becomes the vehicle | map controls |
| If location fails: card at the top with **Select location manually** -> drag the map under a fixed pin, Confirm | map |
| After location: walking route, minutes, distance and next bus at the nearest stop | map |
| **Driver** tab Trip = map like the student one. **Start ride** + ride details (next stop, ETA, passengers, status, share live location, report delay, End ride) | driver |
| Share live location prompt after the driver picks a vehicle. Off = personal location never tracked; the bus then shows its scheduled position | driver |
| **Automatic re-route** (like a navigation app): a vehicle that leaves its route gets a new road route to the next stop (orange line), and ETAs move. Real GPS: 3 fixes more than 80 m off route. Driver can add a delay incident | map, driver |
| **Pass** tab: apply weekly/monthly, optional receipt upload, QR; driver verifies QR or typed `PASS-XXXXXX` | student, driver |
| **Help** tab: cleanliness, driver/stop feedback, lost and found, with photo upload | student |
| **Desk** tab (admin): approve/reject passes, +7 days, revoke, fares, view receipts; categorise, assign, resolve reports, view photos | admin |
| English, Melayu, Bangla: top-right on the sign-in page and in Account for every role | all |
| Offline banner, stale-data warning, queued changes sync on reconnect | all |
| **Account (admin) -> Demo mode**: Simulation on/off, Offline mode, send a bus on another road, event feed. Students and drivers never see the feed | admin |

Notes: routes use the public OSRM demo server (walking and driving). Data lives in the browser (localStorage), so open student, driver and admin in separate windows of the same browser to watch them react to each other.
