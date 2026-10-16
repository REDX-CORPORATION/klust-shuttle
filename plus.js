/* KLUST Shuttle PLUS - add-on loaded after the main script.
   Adds: my-location button, driver live-location sharing + live ride view, dynamic re-routing + delay incidents,
   student passes (QR), issues + lost & found, EN/BM/BN, offline mode, manual location, walking route, live simulation. */
(() => {
'use strict';
const PK = 'klust-plus-v1', DAYMS = 864e5;
const P = { lang: 'en', share: {}, live: {}, det: {}, issues: [], passes: [], pq: [], delta: {}, sim: 0, off: 0, sync: Date.now(), fare: { weekly: 8, monthly: 25, disc: 30 } };
try { Object.assign(P, JSON.parse(localStorage.getItem(PK))); } catch (e) { }
const save = () => { try { localStorage.setItem(PK, JSON.stringify(P)); } catch (e) { } };
const N = () => Date.now(), offline = () => P.off || !navigator.onLine;
const cap = s => s[0].toUpperCase() + s.slice(1), rp = a => a[Math.floor(Math.random() * a.length)];
const dt = ts => new Date(ts).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
const ez = f => .65 * f + .35 * (f < .5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2);
const served = () => [...new Set(liveRoutes().flatMap(r => r.stops))];
const CATS = ['Cleanliness', 'Driver feedback', 'Stop feedback', 'Lost item', 'Found item', 'Other'], TEAMS = ['', 'Cleaning team', 'Transport office', 'Lost & found desk'];

/* ---------- styles ---------- */
const css = document.createElement('style');
css.textContent = `.plus-tools{position:fixed;left:12px;bottom:calc(var(--nav-h,64px) + 14px);z-index:70}.plus-fab{height:40px;padding:0 14px;border-radius:20px;background:var(--primary);color:var(--on-primary);font:700 13px var(--font);box-shadow:var(--sh-2)}
.plus-menu{position:absolute;left:0;bottom:48px;width:270px;background:var(--surface);color:var(--ink);border-radius:14px;box-shadow:var(--sh-3);padding:14px;display:grid;gap:10px;font:500 13px var(--font)}.plus-menu small{color:var(--muted);display:block;max-height:92px;overflow:auto}
.plus-chip{position:absolute;left:12px;right:66px;top:var(--ctl-top,12px);z-index:5;background:var(--surface);color:var(--ink);border-radius:12px;box-shadow:var(--sh-2);padding:9px 12px;font-size:13px;display:grid;gap:3px}.plus-chip span{color:var(--muted)}
.plus-ride{position:fixed;inset:0;z-index:80;background:var(--bg)}.pr-map .smap{position:absolute;inset:0;width:100%;height:100%}.pr-map{position:absolute;inset:0}
.pr-top{position:absolute;top:10px;left:10px;right:10px;z-index:6;display:flex;gap:10px;align-items:center;background:var(--surface);border-radius:12px;padding:8px 12px;box-shadow:var(--sh-2)}.pr-top b{flex:1}
.pr-sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;background:var(--surface);color:var(--ink);border-radius:18px 18px 0 0;padding:16px;box-shadow:var(--sh-3);display:grid;gap:8px}
.plus-off{position:fixed;top:0;left:0;right:0;z-index:95;background:var(--warn-bg);color:var(--warn);font:700 12px var(--font);padding:6px 12px;text-align:center}.plus-off.old{background:var(--danger-bg);color:var(--danger)}
.plus-fabr{position:fixed;right:14px;bottom:calc(var(--nav-h,64px) + 14px);z-index:70}`;
document.head.appendChild(css);

/* ---------- vehicle layer: live GPS share, detours, simulated passengers ---------- */
const _vs = vState, _vp = vPos, _ob = onboard, G = {};
const mkG = ll => { const pts = ll.map(p => merc(p[0], p[1])), cum = [0]; for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return { pts, cum, L: cum[cum.length - 1] }; };
window.vState = (v, t) => { const s = _vs(v, t); if (s && s.visible) s.vid = v.id; return s; };
window.vPos = s => {
  const id = s.vid;
  if (id) {
    const L = P.live[id]; if (P.share[id] && L && N() - L.at < 25e3) return { lat: L.lat, lng: L.lng, ang: L.ang || 0 };
    const d = P.det[id];
    if (d && s.w.mode === 'travel') {
      if (s.w.leg !== d.leg) { delete P.det[id]; delete G[id]; save(); }
      else if (s.w.f >= d.f0) { const e0 = ez(d.f0); return posAt(G[id] || (G[id] = mkG(d.ll)), (ez(s.w.f) - e0) / (1 - e0 || 1)); }
    }
  }
  return _vp(s);
};
window.onboard = (v, t = N()) => (v.status === 'full' || (v.manual != null && t - v.manualAt < 25 * MIN)) ? _ob(v, t) : clamp(_ob(v, t) + (P.delta[v.id] || 0), 0, v.cap);

function incident(v, cat, details, delay) {
  const r = routeById(v.route), now = N();
  Store.set(d => {
    const y = d.vehicles.find(z => z.id === v.id);
    d.incidents.unshift({ id: uid('INC'), kind: 'delay', cat, details, vehicle: v.id, route: r ? r.id : null, driver: v.driver, at: now, status: 'open', delay, affected: onboard(v), photo: null });
    setHold(y, now + delay * MIN);
    if (r) notify(d, { role: 'student', routes: [r.id] }, 'warn', `Route ${r.id.slice(1)} running about ${delay} min late`, `${cat} affecting ${v.id}. Route and arrival times have been updated.`);
    addLog(d, 'incident', `Delay of ${delay} min reported on ${v.id}`);
  });
}
function reroute(v, why) {
  const s = vState(v); if (!s || !s.visible || s.w.mode !== 'travel') { toast('Cannot change route now', 'Only possible while moving between stops.'); return false; }
  const r = s.r, a = _vp(s), b = STOPS[r.stops[(s.w.leg + 1) % r.stops.length]], dx = b.lng - a.lng, dy = b.lat - a.lat, k = (Math.random() < .5 ? -1 : 1) * .2;
  const pt = f => [a.lat + dy * f + dx * k, a.lng + dx * f - dy * k], extra = 3 + Math.floor(Math.random() * 4);
  P.det[v.id] = { leg: s.w.leg, f0: s.w.f, ll: [[a.lat, a.lng], pt(.3), pt(.7), [b.lat, b.lng]], why, extra }; delete G[v.id]; save();
  incident(v, why, 'Driver took an alternative road. Route and ETA updated.', extra); return true;
}
let wid = null;
function share(vid, on) {
  P.share[vid] = !!on; save(); if (wid != null) { navigator.geolocation.clearWatch(wid); wid = null; }
  if (on && navigator.geolocation) wid = navigator.geolocation.watchPosition(g => {
    const o = P.live[vid], la = g.coords.latitude, ln = g.coords.longitude, [x, y] = merc(la, ln); let ang = o ? o.ang : 0;
    if (o) { const [x0, y0] = merc(o.lat, o.lng); if (Math.hypot(x - x0, y - y0) > 2e-7) ang = Math.atan2(y - y0, x - x0) * 180 / Math.PI; }
    P.live[vid] = { lat: la, lng: ln, at: N(), ang }; save();
  }, () => toast('GPS not available', 'Showing the scheduled position instead.'), { enableHighAccuracy: true });
  toast(on ? 'Live location is ON' : 'Live location is OFF', on ? 'Riders can see this vehicle on the map.' : 'Your personal location stays private.', on ? 'ok' : '');
}
function askShare(v) {
  openDialog({ title: 'Share live location?', html: `<p class="muted">Turn on to show <b>${esc(v.id)}</b> live to riders using this phone's GPS. Turn it off and your personal-time location is never tracked.</p><div class="row" style="margin-top:16px"><button class="btn ghost grow" data-x="0">Not now</button><button class="btn primary grow" data-x="1">Share live location</button></div>`, onMount: (b, c) => b.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (x) { share(v.id, x.dataset.x === '1'); c(); } }) });
}
{ const f = App.finish; App.finish = function (s) { f.call(this, s); if (s.role === 'driver') setTimeout(() => { const v = Store.d.vehicles.find(x => x.driver === s.id); v && askShare(v); }, 900); }; }
{ const p = pickVehicleDialog; window.pickVehicleDialog = cb => p(() => { cb && cb(); const v = Driver.veh(); v && askShare(v); }); }

/* ---------- map layer: my-location button, walking route, detour lines ---------- */
const MAPS = new Set(), SM = ShuttleMap.prototype;
function over(m) {
  const vp = m.map.vp; $$('.plus', vp).forEach(n => n.remove());
  const add = (ll, st) => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('class', 'plus'); p.setAttribute('fill', 'none'); p.setAttribute('style', st + ';vector-effect:non-scaling-stroke;stroke-linecap:round'); p.setAttribute('d', 'M' + ll.map(q => m.map.toVec(q[0], q[1]).map(x => x.toFixed(1)).join(' ')).join('L')); vp.appendChild(p); };
  Object.values(P.det).forEach(d => add(d.ll, 'stroke:#f59e0b;stroke-width:5;stroke-dasharray:2 9'));
  if (m._walk) add(m._walk.ll, 'stroke:#2563eb;stroke-width:4;stroke-dasharray:1 8');
}
function chip(m, html) {
  let c = $('.plus-chip', m.box); if (!html) { c && c.remove(); return; }
  if (!c) { c = document.createElement('div'); c.className = 'plus-chip'; m.box.appendChild(c); c.onclick = e => { if (e.target.closest('[data-man]')) manual(); }; } c.innerHTML = html;
}
function ui(m) {
  const u = $('.sm-ui', m.box); if (!u || $('[data-me]', u)) return; const b = document.createElement('button');
  b.dataset.me = 1; b.title = 'My location'; b.setAttribute('aria-label', 'My location');
  b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--info)"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
  b.onclick = ev => { ev.stopPropagation(); locate(m); }; u.appendChild(b);
}
['build', 'paint'].forEach(k => { const o = SM[k]; SM[k] = function () { o.apply(this, arguments); MAPS.add(this); if (k === 'build') ui(this); over(this); }; });
{ const tk = SM.tick; SM.tick = function (n) { tk.call(this, n); if (this._ride && this.um) { const v = vehicleById(this._ride), s = v && vState(v); if (s && s.visible) { const p = vPos(s); this.um.lat = p.lat; this.um.lng = p.lng; } } }; }
async function useLoc(m, p) {
  m._ride = null; m.setUser(p); const [n] = Locate.rank(p, served()), s = STOPS[n.id];
  let ll = [[p.lat, p.lng], [s.lat, s.lng]], min = Math.max(1, Math.round(n.km * 16.25)), km = n.km * 1.3;
  try { const c = new AbortController(); setTimeout(() => c.abort(), 4000); const j = await (await fetch(`https://router.project-osrm.org/route/v1/foot/${p.lng},${p.lat};${s.lng},${s.lat}?overview=full&geometries=geojson`, { signal: c.signal })).json(), R = j.routes[0]; ll = R.geometry.coordinates.map(c => [c[1], c[0]]); min = Math.max(1, Math.round(R.duration / 60)); km = R.distance / 1000; } catch (e) { }
  m._walk = { ll }; over(m);
  const bus = Math.min(...Store.d.vehicles.map(v => etaFor(v, n.id)).filter(x => x != null && isFinite(x)));
  chip(m, `<b>Nearest stop: ${esc(s.short || s.name)}</b><span>${n.km < .06 ? 'You are at this stop' : `${min} min walk, ${Locate.dist(km)}`}${p.manual ? ', location set manually' : ''}${isFinite(bus) ? `, next bus ${etaText(bus)}` : ''}</span>`);
  m.map.user = true; if (n.km >= .06) m.map.fitBounds(ll, {}, true); else m.setStop(n.id, true);
}
{ const g = Locate.get.bind(Locate); Locate.get = () => g().then(p => { MAPS.forEach(m => m.box.isConnected && useLoc(m, p)); return p; }); }
async function locate(m) {
  const b = App.s && App.s.role === 'student' && Store.d.bookings.find(x => x.user === App.s.id && x.status === 'boarded' && (s => s && s.visible)(vState(vehicleById(x.vehicle))));
  if (b) { m._ride = b.vehicle; m._walk = null; m.setUser(vPos(vState(vehicleById(b.vehicle)))); over(m); chip(m, `<b>You are on ${esc(b.vehicle)}</b><span>Your location follows the vehicle</span>`); m.rideCam(b.vehicle); return; }
  chip(m, '<span>Finding your location...</span>');
  try { await Locate.get(); } catch (e) { chip(m, `<b>Can\u2019t find your location</b><span>${esc(Locate.err(e))}</span><button class="btn sm" data-man>Select location manually</button>`); }
}
function manual() {
  openDialog({ title: 'Where are you?', html: `<p class="muted small" style="margin:-6px 0 12px">We can't find your location. Pick the stop you are at or nearest to.</p><div class="vpick">${served().map(id => `<button class="vp" data-s="${id}"><span class="grow"><b>${esc(STOPS[id].name)}</b></span></button>`).join('')}</div>`, onMount: (b, close) => b.addEventListener('click', e => { const x = e.target.closest('[data-s]'); if (!x) return; const s = STOPS[x.dataset.s], p = { lat: s.lat, lng: s.lng, acc: 0, at: N(), manual: true }; Locate.last = p; close(); MAPS.forEach(m => m.box.isConnected && useLoc(m, p)); }) });
}

/* ---------- driver: start ride (live tracking view) ---------- */
let ride = null;
function ask(title, reasons, mins, cb) {
  let r = reasons[0], m = mins ? mins[0] : 0;
  const dlg = openDialog({ title, html: `<div class="chips scroll">${reasons.map(x => `<button class="chip" data-r="${x}" aria-pressed="${x === r}">${x}</button>`).join('')}</div>${mins ? `<div class="chips scroll" style="margin-top:8px">${mins.map(x => `<button class="chip" data-m="${x}" aria-pressed="${x === m}">${x} min</button>`).join('')}</div>` : ''}<button class="btn primary block" data-go="1" style="margin-top:14px">Send</button>`, onMount: (b, close) => b.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.r) { r = t.dataset.r; $$('[data-r]', b).forEach(x => x.setAttribute('aria-pressed', x === t)); } if (t.dataset.m) { m = +t.dataset.m; $$('[data-m]', b).forEach(x => x.setAttribute('aria-pressed', x === t)); } if (t.dataset.go) { close(); cb(r, m); } }) });
}
function startRide() {
  const v = Driver.veh(); if (!v || ride) return;
  Store.set(d => { const x = d.drivers.find(y => y.id === App.s.id); if (x && !x.onShift) { x.onShift = true; x.since = N(); } });
  const o = document.createElement('div'); o.className = 'plus-ride'; o.innerHTML = `<div class="pr-map"></div><div class="pr-top"><b>${esc(v.id)}</b><span class="chip-s ok"><span class="live-dot"></span>Live</span><button class="btn sm" data-a="end">End ride</button></div><div class="pr-sheet"></div>`;
  document.body.appendChild(o);
  const map = new ShuttleMap($('.pr-map', o), { selVehicle: v.id, padding: () => ({ bottom: 250 }) }), sh = $('.pr-sheet', o); map.rideCam(v.id, true);
  const paint = () => {
    const w = Driver.veh(); if (!w) { end(); return; }
    const s = vState(w), ns = s.visible ? nextStop(w) : null, L = onboard(w), d = P.det[w.id], on = !!P.share[w.id];
    sh.innerHTML = `<div class="row between"><div><small>${ns && ns.at ? 'At stop' : 'Next stop'}</small><br><b style="font-size:18px">${ns ? esc(STOPS[ns.sid].name) : esc(s.why || 'Not running')}</b></div><b class="num" style="font-size:22px">${ns ? (ns.at ? 'Boarding' : etaText(ns.min)) : ''}</b></div>
      ${d ? `<p class="hint">${icon('route')}Route updated: ${esc(d.why)}, about +${d.extra} min</p>` : ''}
      <div class="row between"><span>On board <b class="num">${L} / ${w.cap}</b></span><span class="row"><button class="iconbtn" data-a="minus" aria-label="One passenger off">${icon('minus')}</button><button class="iconbtn primary" data-a="plus" aria-label="One passenger on">${icon('plus')}</button></span></div>
      <button class="btn ${on ? 'primary' : 'ghost'} block" data-a="share">${on ? 'Live location ON' : 'Share live location'}</button>
      <div class="row"><button class="btn ghost grow" data-a="det">Take another road</button><button class="btn ghost grow" data-a="delay">Report delay</button></div>`;
  };
  const end = () => { clearInterval(ride.t); share(v.id, false); map.destroy(); o.remove(); ride = null; };
  o.onclick = e => {
    const a = e.target.closest('[data-a]'); if (!a) return; const w = Driver.veh(), k = a.dataset.a;
    if (k === 'end') end();
    if (k === 'share') { share(w.id, !P.share[w.id]); paint(); }
    if (k === 'plus' || k === 'minus') Store.set(d => { const x = d.vehicles.find(y => y.id === w.id); x.manual = clamp(onboard(x) + (k === 'plus' ? 1 : -1), 0, x.cap); x.manualAt = N(); });
    if (k === 'det') ask('Take another road', ['Road blocked', 'Accident ahead', 'Flooding', 'Road works'], null, r => { if (reroute(w, r)) { toast('Route updated', 'Riders see the new route and ETA.', 'ok'); map.rideCam(w.id); } });
    if (k === 'delay') ask('Report delay', ['Heavy traffic', 'Road blocked', 'Breakdown', 'Weather'], [5, 10, 15], (r, m) => { incident(w, r, `Driver reported: ${r}.`, m); toast('Delay reported', `Riders see about ${m} min later.`, 'ok'); });
    paint();
  };
  ride = { t: setInterval(paint, 1000) }; paint(); if (!P.share[v.id]) askShare(v);
}

/* ---------- student pass, help (issues + lost & found), admin desk ---------- */
const approve = p => { p.st = 'approved'; p.to = N() + (p.type === 'weekly' ? 7 : 30) * DAYMS; };
SCREENS.pass = el => {
  let pt = 'weekly';
  const paint = () => {
    const u = App.s.id, mine = P.passes.filter(x => x.uid === u).sort((a, b) => b.at - a.at), act = mine.find(x => x.st === 'approved' && x.to > N()), pen = mine.find(x => x.st === 'pending');
    el.innerHTML = header('Pass', 'Student travel pass', bellBtn()) + `<div class="content narrow stack-l">
      ${act ? `<section class="card" style="text-align:center"><span class="chip-s ok">Approved</span><h3 style="margin:10px 0">${cap(act.type)} pass</h3><div id="pq" style="display:inline-block;padding:10px;background:#fff;border-radius:12px"></div><p class="num" style="margin:8px 0 2px"><b>PASS-${act.code}</b></p><p class="muted small">Show this QR to the driver when boarding</p><b>Valid until ${dt(act.to)}</b><p class="hint" style="justify-content:center">${icon('shield')}Works offline</p></section>`
      : pen ? `<section class="card"><span class="chip-s warn">Pending approval</span><p class="muted" style="margin-top:8px">Your ${pen.type} pass request is waiting for Operations.</p></section>`
      : `<section class="card"><h3 style="margin-bottom:10px">Apply for a pass</h3><div class="seg">${[['weekly', 'Weekly pass'], ['monthly', 'Monthly pass']].map(([k, l]) => `<button data-t="${k}" aria-pressed="${k === pt}">${l}</button>`).join('')}</div><button class="btn primary block" data-apply="1" style="margin-top:12px">Apply</button></section>`}
      <section class="card"><h3 style="margin-bottom:8px">Fare rules</h3><ul class="plist"><li>${icon('ticket')}<span>Weekly pass RM ${P.fare.weekly}, valid 7 days from approval</span></li><li>${icon('ticket')}<span>Monthly pass RM ${P.fare.monthly}, valid 30 days from approval</span></li><li>${icon('shield')}<span>Eligible students get ${P.fare.disc}% off single rides. Passes cannot be shared.</span></li></ul></section></div>`;
    const q = $('#pq', el); act && renderQR(q, 'PASS-' + act.code);
  };
  paint();
  el.onclick = e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.t) { pt = t.dataset.t; paint(); } if (t.dataset.apply) { const id = uid('P'); P.passes.unshift({ id, code: codeFrom('PASS' + id), uid: App.s.id, type: pt, st: 'pending', at: N() }); save(); toast('Application sent', 'Operations will review it shortly.', 'ok'); paint(); } };
  return {};
};
SCREENS.help = el => {
  let c = CATS[0], txt = '';
  const paint = () => {
    const mine = P.issues.filter(i => i.uid === App.s.id);
    el.innerHTML = header('Help', 'Report an issue and lost & found', bellBtn()) + `<div class="content narrow stack-l"><section class="card"><h3 style="margin-bottom:10px">Report an issue</h3><div class="chips scroll">${CATS.map(x => `<button class="chip" data-c="${x}" aria-pressed="${x === c}">${x}</button>`).join('')}</div><label class="field" style="margin-top:10px"><span>Details</span><textarea class="input" id="ht" rows="3" placeholder="What happened? Add the vehicle or stop name.">${esc(txt)}</textarea></label><button class="btn primary block" data-send="1" style="margin-top:10px">Submit</button></section>
      <section class="card"><h3 style="margin-bottom:8px">My reports</h3>${mine.length ? mine.map(i => `<div class="lrow static"><span class="grow"><b>${esc(i.cat)}</b><small>${esc(i.text)}</small></span><span class="chip-s ${i.st === 'resolved' ? 'ok' : i.st === 'new' ? 'warn' : ''}">${i.st === 'prog' ? 'In progress' : cap(i.st)}</span></div>`).join('') : '<p class="muted">Nothing reported yet.</p>'}</section></div>`;
  };
  paint();
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; const t = $('#ht', el); t && (txt = t.value); if (b.dataset.c) { c = b.dataset.c; paint(); } if (b.dataset.send) { if (!txt.trim()) { toast('Add a few details first'); return; } P.issues.unshift({ id: uid('ISS'), uid: App.s.id, cat: c, text: txt.trim(), st: 'new', who: '', at: N() }); save(); txt = ''; toast('Report sent', 'Operations will look into it.', 'ok'); paint(); } };
  return {};
};
SCREENS.desk = el => {
  const nm = id => (Store.d.users[id] && Store.d.users[id].name) || id;
  const paint = () => {
    el.innerHTML = header('Desk', 'Passes, issues and lost & found', bellBtn()) + `<div class="content narrow stack-l"><section class="card"><h3 style="margin-bottom:10px">Student travel pass</h3><div class="row">${[['weekly', 'Weekly RM'], ['monthly', 'Monthly RM'], ['disc', 'Discount %']].map(([k, l]) => `<label class="field grow"><span>${l}</span><input class="input" type="number" data-f="${k}" value="${P.fare[k]}"></label>`).join('')}</div>
      ${P.passes.length ? `<div class="list card-list" style="margin-top:10px">${P.passes.slice(0, 12).map(p => `<div class="lrow static"><span class="grow"><b>${esc(nm(p.uid))}</b><small>${cap(p.type)}, ${p.st}${p.st === 'approved' ? ', expires ' + dt(p.to) : ''}</small></span>${p.st === 'pending' ? `<button class="btn sm primary" data-pa="ok" data-id="${p.id}">Approve</button><button class="btn sm" data-pa="no" data-id="${p.id}">Reject</button>` : p.st === 'approved' ? `<button class="btn sm" data-pa="ext" data-id="${p.id}">+7 days</button><button class="btn sm" data-pa="rev" data-id="${p.id}">Revoke</button>` : ''}</div>`).join('')}</div>` : '<p class="muted" style="margin-top:8px">No pass requests yet.</p>'}</section>
      <section class="card"><h3 style="margin-bottom:8px">Issues and lost & found</h3>${P.issues.length ? P.issues.slice(0, 15).map(i => `<div class="lrow static" style="flex-wrap:wrap;gap:6px"><span class="grow"><b>${esc(i.cat)}</b> <span class="chip-s ${i.st === 'resolved' ? 'ok' : i.st === 'new' ? 'warn' : ''}">${i.st === 'prog' ? 'In progress' : cap(i.st)}</span><small>${esc(i.text)} (${esc(nm(i.uid))})</small></span><select class="input" data-ic="${i.id}">${CATS.map(x => `<option ${x === i.cat ? 'selected' : ''}>${x}</option>`).join('')}</select><select class="input" data-ia="${i.id}">${TEAMS.map(x => `<option value="${x}" ${x === i.who ? 'selected' : ''}>${x || 'Unassigned'}</option>`).join('')}</select><button class="btn sm" data-is="prog" data-id="${i.id}">In progress</button><button class="btn sm primary" data-is="resolved" data-id="${i.id}">Resolve</button></div>`).join('') : '<p class="muted">No reports yet.</p>'}</section></div>`;
  };
  paint();
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return; const id = b.dataset.id, p = P.passes.find(x => x.id === id), i = P.issues.find(x => x.id === id);
    if (b.dataset.pa && p) { const k = b.dataset.pa; if (k === 'ok') approve(p); if (k === 'no') p.st = 'rejected'; if (k === 'ext') p.to += 7 * DAYMS; if (k === 'rev') p.to = N() - 1; }
    if (b.dataset.is && i) i.st = b.dataset.is; save(); paint();
  };
  el.onchange = e => { const t = e.target, i = P.issues.find(x => x.id === (t.dataset.ic || t.dataset.ia)); if (t.dataset.f) P.fare[t.dataset.f] = +t.value || 0; if (t.dataset.ic && i) i.cat = t.value; if (t.dataset.ia && i) i.who = t.value; save(); };
  return {};
};
ROLES.student.tabs.push({ id: 'pass', label: 'Pass', icon: 'ticket' }, { id: 'help', label: 'Help', icon: 'alert' });
ROLES.admin.tabs.splice(2, 0, { id: 'desk', label: 'Desk', icon: 'users' });
{ const cr = checkRider; window.checkRider = (q, v) => {
  const c = q.trim().toUpperCase().replace(/^KLUST:/, '');
  if (/^PASS-[A-Z0-9]{6}$/.test(c)) { const p = P.passes.find(x => 'PASS-' + x.code === c); if (!p || p.st !== 'approved') return { ok: false, why: 'Pass not recognised' }; if (p.to < N()) return { ok: false, why: 'This pass expired on ' + dt(p.to) }; return { ok: true, why: `${cap(p.type)} pass, valid until ${dt(p.to)}${offline() ? ' (checked offline)' : ''}`, walk: true }; }
  const r = cr(q, v); if (r.ok && offline()) r.why += ' (checked from saved passenger list)'; return r; }; }

/* ---------- languages: English, Bahasa Malaysia, Bangla ---------- */
const DX = {}, LI = { ms: 0, bn: 1 }, O = new WeakMap();
`Home|Utama|হোম
Book|Tempah|বুক করুন
Tickets|Tiket|টিকিট
Account|Akaun|অ্যাকাউন্ট
Pass|Pas|পাস
Help|Bantuan|সহায়তা
Trip|Perjalanan|ট্রিপ
Passengers|Penumpang|যাত্রী
Verify|Sahkan|যাচাই
Report|Lapor|রিপোর্ট
Overview|Gambaran|সারসংক্ষেপ
Incidents|Insiden|ঘটনা
Routes|Laluan|রুট
Fleet|Armada|বহর
Insights|Analisis|বিশ্লেষণ
Payments|Bayaran|পেমেন্ট
Desk|Meja|ডেস্ক
Sign in|Log masuk|সাইন ইন
Sign out|Log keluar|সাইন আউট
Student|Pelajar|শিক্ষার্থী
Driver|Pemandu|চালক
Alerts|Makluman|সতর্কতা
My tickets|Tiket saya|আমার টিকিট
Find my nearest stop|Cari perhentian terdekat|নিকটতম স্টপ খুঁজুন
Use my current location|Guna lokasi semasa saya|আমার বর্তমান অবস্থান ব্যবহার করুন
Next stop|Perhentian seterusnya|পরবর্তী স্টপ
At stop|Di perhentian|স্টপে
On shift|Bertugas|ডিউটিতে আছেন
Off shift|Tidak bertugas|ডিউটিতে নেই
On board now|Dalam bas sekarang|এখন বাসে
In service|Beroperasi|চালু আছে
Out of service|Tidak beroperasi|সেবা বন্ধ
Full|Penuh|পূর্ণ
Stops|Perhentian|স্টপসমূহ
Vehicle status|Status kenderaan|গাড়ির অবস্থা
Resume live tracking|Sambung penjejakan langsung|লাইভ ট্র্যাকিং চালু করুন
Done|Selesai|সম্পন্ন
Cancel|Batal|বাতিল
Choose your vehicle|Pilih kenderaan anda|আপনার গাড়ি বেছে নিন
Your privacy|Privasi anda|আপনার গোপনীয়তা
Student travel pass|Pas perjalanan pelajar|শিক্ষার্থী ভ্রমণ পাস
Apply for a pass|Mohon pas|পাসের জন্য আবেদন করুন
Weekly pass|Pas mingguan|সাপ্তাহিক পাস
Monthly pass|Pas bulanan|মাসিক পাস
Apply|Mohon|আবেদন করুন
Approved|Diluluskan|অনুমোদিত
Pending approval|Menunggu kelulusan|অনুমোদনের অপেক্ষায়
Rejected|Ditolak|প্রত্যাখ্যাত
Show this QR to the driver when boarding|Tunjukkan QR ini kepada pemandu semasa menaiki bas|ওঠার সময় চালককে এই QR দেখান
Works offline|Berfungsi tanpa internet|ইন্টারনেট ছাড়াই কাজ করে
Fare rules|Peraturan tambang|ভাড়ার নিয়ম
Report an issue|Lapor isu|সমস্যা জানান
Cleanliness|Kebersihan|পরিচ্ছন্নতা
Driver feedback|Maklum balas pemandu|চালকের মতামত
Stop feedback|Maklum balas perhentian|স্টপের মতামত
Lost item|Barang hilang|হারানো জিনিস
Found item|Barang dijumpai|পাওয়া জিনিস
Other|Lain-lain|অন্যান্য
Submit|Hantar|জমা দিন
My reports|Laporan saya|আমার রিপোর্ট
New|Baharu|নতুন
In progress|Dalam proses|চলমান
Resolved|Selesai|সমাধান হয়েছে
Start ride|Mulakan perjalanan|যাত্রা শুরু করুন
End ride|Tamat perjalanan|যাত্রা শেষ করুন
Share live location|Kongsi lokasi langsung|লাইভ লোকেশন শেয়ার করুন
Live location ON|Lokasi langsung AKTIF|লাইভ লোকেশন চালু
Take another road|Ambil jalan lain|অন্য রাস্তা নিন
Report delay|Lapor kelewatan|দেরি জানান
Select location manually|Pilih lokasi secara manual|হাতে লোকেশন বেছে নিন
Road blocked|Jalan tersekat|রাস্তা বন্ধ
Heavy traffic|Trafik sesak|তীব্র যানজট
Boarding|Menaiki|উঠছে
Now|Sekarang|এখন
Language|Bahasa|ভাষা
Simulation|Simulasi|সিমুলেশন
Offline mode|Mod luar talian|অফলাইন মোড`.split('\n').forEach(l => { const [a, b, c] = l.split('|'); DX[a] = [b, c]; });
const PAT = [[/^(\d+) min$/, ['$1 min', '$1 মিনিট']], [/^Route (\S+) running about (\d+) min late$/, ['Laluan $1 lewat kira-kira $2 min', 'রুট $1 প্রায় $2 মিনিট দেরিতে']], [/^Valid until (.+)$/, ['Sah sehingga $1', 'মেয়াদ $1 পর্যন্ত']]];
const tr = k => { const i = LI[P.lang]; if (i == null) return null; const e = DX[k]; if (e) return e[i]; for (const [re, t] of PAT) if (re.test(k)) return k.replace(re, t[i]); return null; };
const t1 = n => { const o = O.has(n) ? O.get(n) : n.nodeValue, k = o.trim(), t = k && tr(k); if (t) { O.set(n, o); n.nodeValue = o.replace(k, t); } };
const texts = r => { const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT), a = []; let n; while (n = w.nextNode()) a.push(n); return a; };
function setLang(l) { P.lang = l; save(); texts(document.body).forEach(n => { if (O.has(n)) { n.nodeValue = O.get(n); O.delete(n); } }); document.documentElement.lang = l === 'en' ? 'en' : l; texts(document.body).forEach(t1); menu(); }
let q = new Set(), qt = 0;
new MutationObserver(ms => { if (P.lang === 'en') return; ms.forEach(m => m.addedNodes.forEach(n => q.add(n))); if (!qt) qt = requestAnimationFrame(() => { qt = 0; q.forEach(n => { if (!n.isConnected) return; n.nodeType === 3 ? t1(n) : n.nodeType === 1 && texts(n).forEach(t1); }); q = new Set(); }); }).observe(document.body, { childList: true, subtree: true });

/* ---------- offline mode: banner, stale warning, queued changes ---------- */
{ const s = Store.set.bind(Store); Store.set = fn => { if (offline()) { P.pq.push(N()); P.pq = P.pq.slice(-200); save(); } return s(fn); }; }
function offUI() {
  let b = $('.plus-off'); const off = offline();
  if (!off) { b && b.remove(); return; } const age = Math.round((N() - P.sync) / MIN);
  if (!b) { b = document.createElement('div'); document.body.appendChild(b); }
  b.className = 'plus-off' + (age > 10 ? ' old' : '');
  b.textContent = `Offline. Showing saved tickets, passes and passenger lists. Last updated ${fmtTime(P.sync)}${age > 10 ? `. Warning: data is ${age} min old` : ''}${P.pq.length ? `. ${P.pq.length} change${P.pq.length > 1 ? 's' : ''} waiting to sync` : ''}`;
}
function online() { const n = P.pq.length; P.pq = []; P.sync = N(); save(); toast('Back online', n ? `${n} change${n > 1 ? 's' : ''} synced.` : 'Everything is up to date.', 'ok'); offUI(); }
addEventListener('online', () => { if (!P.off) online(); }); addEventListener('offline', offUI);

/* ---------- live simulation for the presentation ---------- */
const NM = ['Aisha', 'Hafiz', 'Nurul', 'Farid', 'Siti', 'Rahim', 'Tanvir', 'Mei Ling', 'Arjun', 'Sumaiya', 'Daniel', 'Faiz'], FEED = [];
const TXT = { Cleanliness: ['Seat was sticky on the morning trip.', 'Rubbish left on the floor.'], 'Driver feedback': ['Very polite driver today, thank you.', 'Bus left a minute early.'], 'Stop feedback': ['No seating at the stop.', 'Stop light is broken.'], 'Lost item': ['Blue umbrella left on the bus.', 'Lost my student card.'], 'Found item': ['Found a water bottle on the back seat.'], Other: ['AC was too cold.'] };
function feed(t) { FEED.unshift(t); FEED.length = Math.min(FEED.length, 8); toast(t, '', '', 2400); menu(); }
let st = null;
function sim(on) {
  P.sim = on ? 1 : 0; save(); clearInterval(st); st = null;
  if (on) { Store.set(d => { d.settings.ignoreDays = d.settings.ignoreHours = true; d.drivers.forEach(x => { x.onShift = true; x.since = x.since || N(); }); }); st = setInterval(simTick, 3500); simTick(); }
  menu();
}
function simTick() {
  const vs = Store.d.vehicles.filter(v => { const s = vState(v); return s && s.visible; }); if (!vs.length) return;
  const v = rp(vs), s = vState(v), sp = STOPS[rp(s.r.stops)], stop = sp.short || sp.name, x = Math.random(), d = P.delta, cur = d[v.id] || 0;
  if (x < .45 && cur < 25) { const n = 1 + Math.floor(Math.random() * 3); d[v.id] = cur + n; feed(`${rp(NM)}${n > 1 ? ' and ' + (n - 1) + ' more' : ''} boarded ${v.id} at ${stop}`); }
  else if (x < .66) { d[v.id] = Math.max(-15, cur - 1 - Math.floor(Math.random() * 3)); feed(`Students got off ${v.id} at ${stop}`); }
  else if (x < .72 && !Store.d.incidents.some(i => i.vehicle === v.id && i.status !== 'resolved')) { const m = 3 + Math.floor(Math.random() * 6), c = rp(['Heavy traffic', 'Weather', 'Road works']); incident(v, c, `${c} slowing ${v.id}.`, m); feed(`${v.id} delayed ${m} min: ${c}`); }
  else if (x < .78 && s.w.mode === 'travel' && !P.det[v.id] && !Store.d.incidents.some(i => i.vehicle === v.id && i.status !== 'resolved')) { const c = rp(['Road blocked', 'Flooding', 'Accident ahead']); if (reroute(v, c)) feed(`${v.id} took another road: ${c}`); }
  else if (x < .89) { const c = rp(CATS), u = rp(Object.keys(Store.d.users)); P.issues.unshift({ id: uid('ISS'), uid: u, cat: c, text: rp(TXT[c]), st: 'new', who: '', at: N() }); feed(`New report: ${c}`); }
  else { const u = rp(Object.keys(Store.d.users)); if (!P.passes.some(p => p.uid === u && p.st === 'pending')) { const id = uid('P'); P.passes.unshift({ id, code: codeFrom('PASS' + id), uid: u, type: rp(['weekly', 'monthly']), st: 'pending', at: N() }); feed(`${(Store.d.users[u] || {}).name || u} applied for a pass`); } }
  P.passes.filter(p => p.st === 'pending' && N() - p.at > 9e3 && Math.random() < .5).forEach(approve);
  P.issues.filter(i => i.st !== 'resolved' && N() - i.at > 45e3 && Math.random() < .3).forEach(i => { i.st = i.st === 'new' ? 'prog' : 'resolved'; i.who = i.who || rp(TEAMS.slice(1)); });
  Store.d.incidents.filter(i => i.status !== 'resolved' && i.kind === 'delay' && N() - i.at > 80e3).forEach(i => resolveIncident(i.id, 'Operations'));
  P.passes = P.passes.slice(0, 40); P.issues = P.issues.slice(0, 40); save();
  if (['pass', 'help', 'desk'].includes(App.tab) && !App.busy()) App.refresh();
}

/* ---------- demo tools menu + ride button ---------- */
const tools = document.createElement('div'); tools.className = 'plus-tools'; document.body.appendChild(tools); let open = false;
function menu() {
  tools.innerHTML = `${open ? `<div class="plus-menu"><div><b>Language</b><div class="seg" style="margin-top:6px">${[['en', 'English'], ['ms', 'BM'], ['bn', 'বাংলা']].map(([k, l]) => `<button data-l="${k}" aria-pressed="${P.lang === k}">${l}</button>`).join('')}</div></div>
    <div class="row between"><b>Simulation</b><button class="btn sm ${P.sim ? 'primary' : ''}" data-sim="1">${P.sim ? 'Running' : 'Start'}</button></div>
    <div class="row between"><b>Offline mode</b><button class="btn sm ${P.off ? 'primary' : ''}" data-off="1">${P.off ? 'On' : 'Off'}</button></div>${FEED.length ? `<small>${FEED.map(esc).join('<br>')}</small>` : ''}</div>` : ''}<button class="plus-fab" data-tg="1">Demo tools</button>`;
}
tools.onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tg) { open = !open; menu(); }
  if (b.dataset.l) setLang(b.dataset.l);
  if (b.dataset.sim) sim(!P.sim);
  if (b.dataset.off) { P.off = P.off ? 0 : 1; save(); if (!P.off && navigator.onLine) online(); else toast('Offline mode on', 'Saved tickets, passes and passenger lists still work.'); offUI(); menu(); }
};
menu();
addEventListener('storage', e => { if (e.key === PK) { try { Object.assign(P, JSON.parse(e.newValue)); } catch (x) { } if (['pass', 'help', 'desk'].includes(App.tab) && !App.busy()) App.refresh(); } });
setInterval(() => {
  if (!offline()) P.sync = N();
  offUI();
  let f = $('.plus-fabr'); const show = App.s && App.s.role === 'driver' && Driver.veh() && !ride;
  if (show && !f) { f = document.createElement('div'); f.className = 'plus-fabr'; f.innerHTML = '<button class="plus-fab" style="height:46px">Start ride</button>'; f.onclick = startRide; document.body.appendChild(f); }
  if (!show && f) f.remove();
  if (ride && !(App.s && App.s.role === 'driver')) { $('.plus-ride') && $('.plus-ride').remove(); clearInterval(ride.t); ride = null; }
}, 1000);
if (P.sim) sim(true);
if (App.s) App.render(false);
if (P.lang !== 'en') setLang(P.lang);
})();
