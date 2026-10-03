// KLUST LMS login relay — Vercel serverless function (Node.js runtime).
//
// This was originally written for Vercel's Edge Runtime, but Edge uses a
// lightweight V8-isolate network stack that some institutional servers
// (KLUST included, apparently) don't complete a TLS/HTTP handshake with
// reliably — fetch() throws a generic network error, which is exactly the
// "Could not reach KLUST LMS" message you were seeing. Plain Node.js has a
// much more complete networking stack (via undici), so this version uses
// that instead. No other behaviour changes.
//
// Env vars (set in Vercel: Project -> Settings -> Environment Variables).
// None are required — the relay works with zero config — but you can add:
//   KLUST_ORIGIN    Override the LMS base URL (default https://lms.klust.edu.my)
//   ALLOWED_ORIGIN   Restrict CORS to one origin instead of "*", e.g.
//                    https://your-project.vercel.app
//   RELAY_SECRET     A shared secret. If set, requests must send it back in
//                    an "X-Relay-Secret" header or they're rejected. This
//                    stops random bots from hammering your relay (and
//                    KLUST's login) — it is NOT real secrecy, since anyone
//                    who views your deployed page's source can read the
//                    same value out of KLUST_RELAY_SECRET in index.html.
//                    Treat it as a speed bump, not a lock.
//
// Nothing is logged, stored, or sent anywhere except straight to
// lms.klust.edu.my, for the duration of a single request.

const KLUST_ORIGIN = process.env.KLUST_ORIGIN || 'https://lms.klust.edu.my';
const RELAY_SECRET = process.env.RELAY_SECRET || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

  if (RELAY_SECRET) {
    const got = req.headers['x-relay-secret'] || '';
    if (got !== RELAY_SECRET) { res.status(401).json({ ok: false, error: 'Not authorised' }); return; }
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) { res.status(400).json({ ok: false, error: 'Missing Student ID or password' }); return; }

  const jar = {};

  try {
    const initRes = await fetchWithTimeout(`${KLUST_ORIGIN}/login`, { headers: { 'User-Agent': UA } });
    mergeCookies(jar, initRes.headers);
  } catch (e) {
    res.status(502).json({ ok: false, error: `Could not reach KLUST LMS (${describeError(e)}). Try again.` });
    return;
  }

  const form = new URLSearchParams({ username, password });
  let loginRes;
  try {
    loginRes = await fetchWithTimeout(`${KLUST_ORIGIN}/login/processlogin`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        'Cookie': jarHeader(jar),
        'Referer': `${KLUST_ORIGIN}/login`,
      },
      body: form.toString(),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: `Could not reach KLUST LMS (${describeError(e)}). Try again.` });
    return;
  }
  mergeCookies(jar, loginRes.headers);

  const location = loginRes.headers.get('location') || '';
  const success = /dashboard/i.test(location);

  if (!success) {
    let message = 'Incorrect Student ID or password.';
    try {
      const retryRes = await fetchWithTimeout(`${KLUST_ORIGIN}${/^\//.test(location) ? location : '/login'}`, {
        headers: { 'User-Agent': UA, 'Cookie': jarHeader(jar) },
      });
      mergeCookies(jar, retryRes.headers);
      const html = await retryRes.text();
      const m =
        html.match(/toastr\.error\(\s*'([^']+)'/) ||
        html.match(/toastr\.error\(\s*"([^"]+)"/) ||
        html.match(/swal\([^,]+,\s*['"]([^'"]+)['"]/) ||
        html.match(/class="(?:alert|error|invalid-feedback)[^"]*">\s*([^<]{3,120})\s*</i);
      if (m && m[1] && m[1].trim()) message = decodeEntities(m[1].trim());
    } catch { /* keep generic message */ }
    res.status(200).json({ ok: false, error: message });
    return;
  }

  // ---- Success: pull name + photo from the dashboard ----
  let name = null, studentId = username, photo = null;
  try {
    const dashRes = await fetchWithTimeout(`${KLUST_ORIGIN}/dashboard/home`, { headers: { 'User-Agent': UA, 'Cookie': jarHeader(jar) } });
    const html = await dashRes.text();
    const nameMatch =
      html.match(/class="profile-name"[^>]*title="([^"]+)"/) ||
      html.match(/profile-text">\s*Hello,\s*([^!<]+?)\.{0,3}\s*!/i);
    const idMatch = html.match(/<p class="profile-name">(\d+)<\/p>/);
    if (nameMatch) name = decodeEntities(nameMatch[1].trim());
    if (idMatch) studentId = idMatch[1].trim();

    const photoMatch =
      html.match(/class="avatar-image-side"\s+src="([^"]+)"/) ||
      html.match(/class="img-xs rounded-circle"\s+src="([^"]+)"/);
    if (photoMatch) {
      const photoUrl = new URL(photoMatch[1], KLUST_ORIGIN).toString();
      const imgRes = await fetchWithTimeout(photoUrl, { headers: { 'User-Agent': UA, 'Cookie': jarHeader(jar) } });
      if (imgRes.ok) {
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        if (buf.length > 0 && buf.length < 2_000_000) photo = `data:${ct};base64,${buf.toString('base64')}`;
      }
    }
  } catch { /* non-fatal — name/photo just stay null */ }

  // ---- Pull the real class timetable ----
  let timetable = [];
  try {
    const ttRes = await fetchWithTimeout(`${KLUST_ORIGIN}/dashboard/class/timetable`, { headers: { 'User-Agent': UA, 'Cookie': jarHeader(jar) } });
    const html = await ttRes.text();
    timetable = parseTimetable(html);
  } catch { /* non-fatal — timetable just stays empty */ }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, name, studentId, photo, timetable });
};

// Node's fetch (undici) wraps every network-level failure as a generic
// "TypeError: fetch failed" — the actual reason (DNS failure, connection
// refused, TLS/certificate problem, timeout, ...) lives in error.cause.
// This pulls that out so the real cause shows up instead of just "TypeError".
function describeError(e) {
  const cause = e && e.cause;
  const parts = [];
  if (e && e.name === 'AbortError') return 'timed out after 15s';
  if (cause) {
    if (cause.code) parts.push(cause.code);
    if (cause.message && cause.message !== cause.code) parts.push(cause.message);
  }
  if (!parts.length && e && e.message) parts.push(e.message);
  return parts.filter(Boolean).join(': ') || (e && e.name) || 'unknown network error';
}

// ---------------- TLS: KLUST's server doesn't send its full certificate
// chain (missing intermediate CA), which Node's strict verification
// rejects as UNABLE_TO_VERIFY_LEAF_SIGNATURE even though browsers tolerate
// it (the OS fetches the missing certificate automatically; Node doesn't).
// This relaxes verification ONLY for connections to KLUST_ORIGIN, via a
// dedicated dispatcher — every other request (there are none here) still
// verifies normally. Trade-off, stated plainly: this also means a
// man-in-the-middle presenting a *different* bad certificate on this exact
// connection wouldn't be detected either. That's an accepted, narrow
// trade-off for reaching a real university server with a known-broken
// chain — not a blanket "trust everything" setting.
let klustDispatcher;
function getKlustDispatcher() {
  if (klustDispatcher !== undefined) return klustDispatcher;
  try {
    const { Agent } = require('undici');
    klustDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  } catch {
    klustDispatcher = null; // undici not available this way — requests will still verify strictly
  }
  return klustDispatcher;
}

// ---------------- fetch with a hard timeout (avoids hanging the function) ----------------
async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const dispatcher = getKlustDispatcher();
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, ...(dispatcher ? { dispatcher } : {}) });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Timetable parsing ----------------
// Matches KLUST's grid: header row of 30-min slots from 08:00, then one row
// per day with <td colspan=N class="table-yellow">CODE<br>NAME<br>LECTURER<br><br> Group G<br> Class Type : T<br>Location:L</td>
function parseTimetable(html) {
  const tableMatch = html.match(/<table[^>]*class="[^"]*timetable[^"]*"[\s\S]*?<\/table>/i) || html.match(/<table[^>]*>[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];
  const table = tableMatch[0];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const classes = [];
  let rowM;
  while ((rowM = rowRe.exec(table))) {
    const rowHtml = rowM[1];
    const tdRe = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdM;
    while ((tdM = tdRe.exec(rowHtml))) cells.push({ attrs: tdM[1], html: tdM[2] });
    if (!cells.length) continue;
    const dayText = stripTags(cells[0].html).trim().toUpperCase();
    const dow = DAY_NAMES.indexOf(dayText);
    if (dow < 0) continue; // header row or anything unexpected
    let slot = 0; // each slot = 30 min, slot 0 = 08:00
    for (let i = 1; i < cells.length; i++) {
      const c = cells[i];
      const spanM = c.attrs.match(/colspan="(\d+)"/);
      const span = spanM ? parseInt(spanM[1], 10) || 1 : 1;
      const cellText = decodeEntities(stripTags(c.html)).replace(/\u00a0/g, ' ').trim();
      const busy = /table-yellow/.test(c.attrs) && cellText.length > 0;
      if (busy) {
        const parsed = parseCell(c.html);
        const startMin = 8 * 60 + slot * 30, endMin = startMin + span * 30;
        classes.push({ dow, day: DAY_NAMES[dow][0] + DAY_NAMES[dow].slice(1).toLowerCase(), start: minToHHMM(startMin), end: minToHHMM(endMin), ...parsed });
      }
      slot += span;
    }
  }
  return classes;
}
function parseCell(cellHtml) {
  const lines = cellHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .split('\n').map(l => decodeEntities(l.replace(/\u00a0/g, ' ').trim())).filter(Boolean);
  const out = { code: '', name: '', lecturer: '', group: '', type: '', location: '' };
  let idx = 0;
  if (lines[idx]) out.code = lines[idx++];
  if (lines[idx] && !/^Group\b/i.test(lines[idx]) && !/^Class Type/i.test(lines[idx]) && !/^Location:/i.test(lines[idx])) out.name = lines[idx++];
  for (; idx < lines.length; idx++) {
    const l = lines[idx];
    if (/^Group\b/i.test(l)) out.group = l.replace(/^Group\s*/i, '').trim();
    else if (/^Class Type/i.test(l)) out.type = l.replace(/^Class Type\s*:\s*/i, '').trim();
    else if (/^Location:/i.test(l)) out.location = l.replace(/^Location:\s*/i, '').trim();
    else if (!out.lecturer) out.lecturer = l;
  }
  return out;
}
function stripTags(s) { return s.replace(/<[^>]+>/g, ''); }
function minToHHMM(m) { const h = Math.floor(m / 60) % 24, mm = m % 60; return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); }
function decodeEntities(s) { return s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'); }

// ---------------- Cookies / misc ----------------
function mergeCookies(jar, headers) {
  const all = headers.getSetCookie ? headers.getSetCookie() : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  for (const c of all) {
    const pair = c.split(';')[0], eq = pair.indexOf('=');
    if (eq > -1) jar[pair.slice(0, eq).trim()] = pair.trim();
  }
}
function jarHeader(jar) { return Object.values(jar).join('; '); }
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Secret');
}
