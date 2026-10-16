/* KLUST Shuttle PLUS - add-on loaded after the main script.
   Adds: my-location button, driver live-location sharing + live ride view, dynamic re-routing + delay incidents,
   student passes (QR), issues + lost & found, EN/BM/BN, offline mode, manual location, walking route, live simulation. */
(() => {
'use strict';
const PK = 'klust-plus-v1', DAYMS = 864e5;
const P = { lang: 'en', feed: [], share: {}, live: {}, det: {}, issues: [], passes: [], pq: [], delta: {}, sim: 0, off: 0, sync: Date.now(), fare: { weekly: 8, monthly: 25, disc: 30 } };
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
css.textContent = `.plus-chip{position:fixed;left:12px;right:12px;max-width:440px;top:calc(76px + env(safe-area-inset-top));z-index:60;background:var(--surface);color:var(--ink);border-radius:12px;box-shadow:var(--sh-3);padding:10px 34px 10px 12px;font-size:13px;display:grid;gap:4px}@media(min-width:960px){.plus-chip{left:490px}}
.plus-chip span{color:var(--muted)}.plus-x{position:absolute;top:4px;right:6px;width:26px;height:26px;font-size:18px;color:var(--muted)}
.plus-pin{position:absolute;left:50%;top:50%;z-index:7;pointer-events:none;transform:translate(-50%,-100%);transition:transform .15s}.plus-pin.lift{transform:translate(-50%,calc(-100% - 10px))}.plus-pin i{position:absolute;left:50%;bottom:-3px;width:10px;height:5px;border-radius:50%;background:rgba(0,0,0,.35);transform:translateX(-50%)}
.plus-pinbar{position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h,64px) + 14px);max-width:460px;margin:0 auto;z-index:70;background:var(--surface);color:var(--ink);border-radius:16px;box-shadow:var(--sh-3);padding:14px;display:grid;gap:8px}
.plus-lang{position:fixed;top:calc(10px + env(safe-area-inset-top));right:12px;z-index:50}.plus-lang .seg button{font-size:12px;padding:0 10px;height:28px}
.plus-th{height:44px;width:44px;object-fit:cover;border-radius:8px;flex:none}
.plus-off{position:fixed;top:0;left:0;right:0;z-index:95;background:var(--warn-bg);color:var(--warn);font:700 12px var(--font);padding:6px 12px;text-align:center}.plus-off.old{background:var(--danger-bg);color:var(--danger)}`;
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
async function osrm(prof, pts) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 5000);
  try { const j = await (await fetch(`https://router.project-osrm.org/route/v1/${prof}/${pts.map(p => p[1] + ',' + p[0]).join(';')}?overview=full&geometries=geojson`, { signal: c.signal })).json(), R = j.routes[0]; return { ll: R.geometry.coordinates.map(c => [c[1], c[0]]), min: R.duration / 60, km: R.distance / 1000 }; } finally { clearTimeout(t); }
}
/* Like a navigation app: when a vehicle leaves its fixed route, a new road route to the next stop is drawn and every ETA moves. */
const busy = {}, strikes = {};
async function reroute(v, why, via, from) {
  const s = vState(v); if (!s || !s.visible || s.w.mode !== 'travel' || P.det[v.id] || busy[v.id]) return false;
  const r = s.r, leg = s.w.leg, a = from || _vp(s), b = STOPS[r.stops[(leg + 1) % r.stops.length]];
  if (r.legs[leg] * s.w.f < 1.3) return false;
  busy[v.id] = 1;
  try {
    const mid = via ? via(a, b) : null, R = await osrm('driving', [[a.lat, a.lng], ...(mid ? [mid] : []), [b.lat, b.lng]]), s2 = vState(v);
    if (!s2 || !s2.visible || s2.w.leg !== leg || s2.w.mode !== 'travel') return false;
    const extra = clamp(Math.round(R.min - r.legs[leg] * (1 - s2.w.f)), 1, Math.max(1, Math.floor(r.legs[leg] * s2.w.f * .9)));
    Store.set(d => { const x = d.vehicles.find(z => z.id === v.id); x.shiftMs = (x.shiftMs || 0) + extra * MIN; notify(d, { role: 'student', routes: [r.id] }, 'warn', `${v.id} took another road`, `Route ${r.id.slice(1)} updated. Expect about ${extra} min delay.`); addLog(d, 'route', `${v.id} re-routed (${why})`); });
    const s3 = vState(v); if (!s3 || s3.w.mode !== 'travel' || s3.w.leg !== leg) return false;
    P.det[v.id] = { leg, f0: s3.w.f, ll: [[a.lat, a.lng], ...R.ll], why, extra }; delete G[v.id]; save(); return extra;
  } catch (e) { return false; } finally { busy[v.id] = 0; }
}
const viaFn = (a, b) => { const dx = b.lng - a.lng, dy = b.lat - a.lat, L = Math.hypot(dx, dy) || 1e-6, o = clamp(L * .3, .0025, .007) * (Math.random() < .5 ? -1 : 1); return [a.lat + dy / 2 + dx / L * o, a.lng + dx / 2 - dy / L * o]; };
const segD = (x, y, p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = dx * dx + dy * dy, t = L ? clamp(((x - p[0]) * dx + (y - p[1]) * dy) / L, 0, 1) : 0; return Math.hypot(x - p[0] - t * dx, y - p[1] - t * dy); };
function offRoute(vid, la, ln) { // real GPS only: 3 fixes more than 80 m from the fixed route -> reroute from where the driver actually is
  const v = vehicleById(vid), s = v && vState(v); if (!s || !s.visible) return;
  const [x, y] = merc(la, ln), pts = Geo.routeLL(s.r).map(p => merc(p[0], p[1])); if (pts.length < 2) return;
  let b = 1e9; for (let i = 1; i < pts.length; i++) b = Math.min(b, segD(x, y, pts[i - 1], pts[i]));
  const m = b * 40075016 * Math.cos(la * Math.PI / 180);
  if (m > 80) { strikes[vid] = (strikes[vid] || 0) + 1; if (strikes[vid] >= 3 && !P.det[vid]) reroute(v, 'Off route', null, { lat: la, lng: ln }); }
  else { strikes[vid] = 0; if (m < 40 && P.det[vid]) { delete P.det[vid]; delete G[vid]; save(); } }
}
let wid = null;
function share(vid, on) {
  P.share[vid] = !!on; save(); if (wid != null) { navigator.geolocation.clearWatch(wid); wid = null; }
  if (on && navigator.geolocation) wid = navigator.geolocation.watchPosition(g => {
    const o = P.live[vid], la = g.coords.latitude, ln = g.coords.longitude, [x, y] = merc(la, ln); let ang = o ? o.ang : 0;
    if (o) { const [x0, y0] = merc(o.lat, o.lng); if (Math.hypot(x - x0, y - y0) > 2e-7) ang = Math.atan2(y - y0, x - x0) * 180 / Math.PI; }
    P.live[vid] = { lat: la, lng: ln, at: N(), ang }; save(); offRoute(vid, la, ln);
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
  Object.values(P.det).forEach(d => { add(d.ll, 'stroke:#fff;stroke-width:10'); add(d.ll, 'stroke:#f59e0b;stroke-width:6'); });
  if (m._walk) add(m._walk.ll, 'stroke:#2563eb;stroke-width:4;stroke-dasharray:1 8');
}
function chip(m, html) {
  let c = $('#plus-chip'); if (!html) { c && c.remove(); return; }
  if (!c) { c = document.createElement('div'); c.id = 'plus-chip'; c.className = 'plus-chip'; document.body.appendChild(c); c.onclick = e => { if (e.target.closest('[data-man]')) pin(c._m); if (e.target.closest('[data-x]')) c.remove(); }; }
  c._m = m; c.innerHTML = html + '<button class="plus-x" data-x="1" aria-label="Close">\u00d7</button>';
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
  let ll = [[p.lat, p.lng], [s.lat, s.lng]], min = Math.max(1, Math.round(n.km * 1.3 * 12)), km = n.km * 1.3;
  try { const c = new AbortController(); setTimeout(() => c.abort(), 4000); const j = await (await fetch(`https://router.project-osrm.org/route/v1/foot/${p.lng},${p.lat};${s.lng},${s.lat}?overview=full&geometries=geojson`, { signal: c.signal })).json(), R = j.routes[0]; ll = R.geometry.coordinates.map(c => [c[1], c[0]]); km = R.distance / 1000; min = Math.max(1, Math.round(km * 12)); } catch (e) { }
  m._walk = { ll }; over(m);
  const etas = Store.d.vehicles.map(v => etaFor(v, n.id)).filter(x => x != null && isFinite(x)), walk = n.km < .06 ? 0 : min, ok = etas.filter(x => x >= walk - 1), bus = ok.length ? Math.min(...ok) : Math.min(...etas);
  chip(m, `<b>Nearest stop: ${esc(s.short || s.name)}</b><span>${n.km < .06 ? 'You are at this stop' : `${min} min walk, ${Locate.dist(km)}`}${p.manual ? ', location set manually' : ''}${isFinite(bus) ? (ok.length ? `, next bus you can catch: ${etaText(bus)}` : `, next bus ${etaText(bus)}, you may miss it`) : ''}</span>`);
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

/* ---------- location pin (drag the map, like a ride-hailing app) ---------- */
function pin(m) {
  if (!m || !m.box.isConnected || m._pin) return; chip(m, null);
  const sh = $('#sheet'); sh && (sh.style.display = 'none'); m.map.user = true; m.followV = null;
  if (Locate.last) { const [x, y] = merc(Locate.last.lat, Locate.last.lng); m.map.flyTo(x, y, Math.max(m.map.z, 15)); } else m.map.flyTo(m.map.mx, m.map.my, Math.max(m.map.z, 15));
  const el = document.createElement('div'); el.className = 'plus-pin';
  el.innerHTML = '<svg viewBox="0 0 32 44" width="38" height="52"><path d="M16 1C8 1 2 7 2 15c0 11 14 28 14 28s14-17 14-28C30 7 24 1 16 1z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15" r="5" fill="#fff"/></svg><i></i>'; m.box.appendChild(el);
  const bar = document.createElement('div'); bar.className = 'plus-pinbar';
  bar.innerHTML = '<b>Move the map to set your location</b><span class="muted small" id="pp">&nbsp;</span><div class="row"><button class="btn ghost grow" data-pc="1">Cancel</button><button class="btn primary grow" data-po="1">Confirm location</button></div><button class="linkbtn" data-pl="1">Pick a stop from a list instead</button>'; document.body.appendChild(bar);
  const ctr = () => { const [la, ln] = unmerc(m.map.mx, m.map.my); return { lat: la, lng: ln }; };
  const tm = setInterval(() => { if (!m.box.isConnected) { done(); return; } const [n] = Locate.rank(ctr(), served()); $('#pp', bar).textContent = `Nearest stop: ${STOPS[n.id].short || STOPS[n.id].name}, ${Locate.dist(n.km)}`; }, 300);
  const lift = () => el.classList.add('lift'), drop = () => el.classList.remove('lift');
  m.box.addEventListener('pointerdown', lift); addEventListener('pointerup', drop);
  const done = () => { clearInterval(tm); el.remove(); bar.remove(); sh && (sh.style.display = ''); m.box.removeEventListener('pointerdown', lift); removeEventListener('pointerup', drop); m._pin = null; };
  m._pin = done;
  bar.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pc) done(); if (b.dataset.pl) { done(); manual(); }
    if (b.dataset.po) { const c = ctr(), p = { lat: c.lat, lng: c.lng, acc: 0, at: N(), manual: true }; done(); Locate.last = p; MAPS.forEach(mm => mm.box.isConnected && useLoc(mm, p)); }
  };
}

/* ---------- driver: map view like the student one, with Start ride and ride details ---------- */
function ask(title, reasons, mins, cb) {
  let r = reasons[0], m = mins ? mins[0] : 0;
  openDialog({ title, html: `<div class="chips scroll">${reasons.map(x => `<button class="chip" data-r="${x}" aria-pressed="${x === r}">${x}</button>`).join('')}</div>${mins ? `<div class="chips scroll" style="margin-top:8px">${mins.map(x => `<button class="chip" data-m="${x}" aria-pressed="${x === m}">${x} min</button>`).join('')}</div>` : ''}<button class="btn primary block" data-go="1" style="margin-top:14px">Send</button>`, onMount: (b, close) => b.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.r) { r = t.dataset.r; $$('[data-r]', b).forEach(x => x.setAttribute('aria-pressed', x === t)); } if (t.dataset.m) { m = +t.dataset.m; $$('[data-m]', b).forEach(x => x.setAttribute('aria-pressed', x === t)); } if (t.dataset.go) { close(); cb(r, m); } }) });
}
SCREENS.trip = el => {
  const st = App.ui.drv || (App.ui.drv = { open: false, cam: false }), v0 = Driver.veh(), desk = () => innerWidth >= 960; st.cam = false;
  el.innerHTML = `<div class="home" id="homeRoot"><div class="home-top"><div class="pill brandpill">${logo()}<div><b id="dt">KLUST Shuttle</b><small><span class="live-dot"></span><span id="ds"></span></small></div></div><span class="grow"></span><span class="pill pill-icon">${bellBtn()}</span></div><section class="sheet ${st.open ? 'open' : ''}" id="sheet" aria-label="Ride"><div class="grabber" id="grab" role="button" tabindex="0" aria-label="Expand or collapse"><i></i></div><div class="sheet-body" id="sbody"></div></section></div>`;
  const root = $('#homeRoot', el), body = $('#sbody', el), sheet = $('#sheet', el);
  const map = new ShuttleMap(root, { selVehicle: v0 && v0.id, padding: () => desk() ? { top: 90, right: 80, bottom: 40, left: 470 } : { top: 84, right: 64, bottom: 330, left: 104 } });
  root.insertBefore(map.box, root.firstChild);
  const grab = $('#grab', el); let sy = null, base = 0, dy = 0; const toggle = o => { st.open = o; sheet.classList.toggle('open', o); };
  grab.addEventListener('pointerdown', e => { sy = e.clientY; dy = 0; base = st.open ? 0 : sheet.offsetHeight - parseFloat(getComputedStyle(sheet).getPropertyValue('--peek') || 272); sheet.classList.add('dragging'); grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointermove', e => { if (sy == null) return; dy = e.clientY - sy; sheet.style.transform = `translateY(${clamp(base + dy, 0, sheet.offsetHeight - 120)}px)`; });
  const up = () => { if (sy == null) return; sheet.classList.remove('dragging'); sheet.style.transform = ''; if (Math.abs(dy) < 6) toggle(!st.open); else toggle(dy < 0); sy = null; };
  grab.addEventListener('pointerup', up); grab.addEventListener('pointercancel', up);
  const paint = () => {
    const d = Driver.me(), v = Driver.veh();
    if (!v) { body.innerHTML = emptyState('bus', 'Choose your vehicle', 'Pick the vehicle you are driving to start.') + '<button class="btn primary block" data-act="veh">Choose vehicle</button>'; return; }
    const r = routeById(v.route), s = vState(v), on = !!(d && d.onShift), ns = s.visible ? nextStop(v) : null, load = onboard(v), vs = vehicleStatus(v), inc = Store.d.incidents.find(i => i.vehicle === v.id && i.status !== 'resolved'), det = P.det[v.id], sharing = !!P.share[v.id], following = map.followV === v.id;
    $('#dt', el).textContent = v.id; $('#ds', el).textContent = on ? 'On ride' : 'Off shift';
    const top = `<div class="row between" style="margin-bottom:10px"><span class="chip-s ${on ? 'ok' : ''}">${on ? '<span class="live-dot"></span>' : ''}${on ? (following ? 'Tracking your ride' : 'Ride live') : 'Not started'}</span>${on && !following ? `<button class="linkbtn" data-act="recenter">${icon('locate')}Re-centre</button>` : ''}</div>`;
    const shareBtn = `<button class="btn ${sharing ? 'primary' : 'ghost'} block" data-act="share">${sharing ? 'Live location ON' : 'Share live location'}</button>`;
    if (!on) { body.innerHTML = top + `<article class="next" style="--c:${r ? r.color : '#2563eb'}"><div class="next-head">${r ? badge(r) : ''}<span class="grow"><b>${esc(r ? r.name : 'No route')}</b><small>${esc(v.id)}, ${esc(v.plate)}</small></span></div><p class="small muted" style="padding:6px 0 12px">Start your ride to go live. Riders will see this vehicle on the map.</p><button class="btn primary block" data-act="start">Start ride</button></article><div style="margin-top:12px">${shareBtn}</div>`; return; }
    const fin = ns && isFinite(ns.min), soon = ns && (ns.at || ns.min < .75);
    body.innerHTML = top + `<article class="next" style="--c:${r.color}"><div class="next-head">${badge(r)}<span class="grow"><b>${ns ? (ns.at ? 'At ' : 'Next: ') + esc(STOPS[ns.sid].name) : esc(s.why || 'Not running')}</b><small>${esc(v.id)}, ${esc(v.plate)}</small></span><span class="chip-s ${vs.cls}">${esc(vs.text)}</span></div>
      <div class="next-eta"><span class="num">${!ns ? '-' : soon ? 'Now' : fin ? Math.round(ns.min) : '-'}</span>${ns && !soon && fin ? '<span class="unit">min</span>' : ''}</div>
      <div class="next-foot">${meter(load, v.cap)}<span class="small">${load} / ${v.cap} on board</span></div></article>
      ${det ? `<div class="dh-inc delay" style="margin-top:12px">${icon('route')}<span class="grow">Route updated to a new road. Arrival times have been updated for riders.</span></div>` : ''}
      ${inc ? `<div class="dh-inc delay" style="margin-top:12px">${icon('alert')}<span class="grow"><b>${esc(inc.cat)}</b><small>${inc.delay ? `${inc.delay} min delay reported` : 'Reported'}</small></span><button class="btn sm" data-act="resolve" data-id="${inc.id}">Back on schedule</button></div>` : ''}
      <div class="row between" style="margin:14px 0 10px"><span>Passengers on board</span><span class="row"><button class="iconbtn" data-act="minus" aria-label="One passenger off">${icon('minus')}</button><button class="iconbtn primary" data-act="plus" aria-label="One passenger on">${icon('plus')}</button></span></div>
      <div class="seg" style="margin-bottom:10px">${[['', 'In service'], ['full', 'Full'], ['out', 'Out of service']].map(([k, l]) => `<button data-st="${k}" aria-pressed="${(v.status || '') === k}">${l}</button>`).join('')}</div>
      ${shareBtn}<div class="row" style="margin-top:8px"><button class="btn ghost grow" data-act="delay">Report delay</button><button class="btn ghost grow" data-act="end">End ride</button></div>
      ${ns ? `<ol class="tl" style="--c:${r.color};margin-top:14px">${(() => { const k0 = r.stops.indexOf(ns.sid); return r.stops.map((_, i) => r.stops[(k0 + i) % r.stops.length]).map((sid, i) => { const mm = etaFor(v, sid); return `<li class="${i === 0 ? 'next' : ''}"><b>${esc(STOPS[sid].name)}</b><small>${i === 0 && ns.at ? 'Here now' : `${etaText(mm)}${isFinite(mm) ? `, ${fmtTime(Date.now() + mm * MIN)}` : ''}`}</small></li>`; }).join(''); })()}</ol>` : ''}`;
  };
  paint();
  body.addEventListener('click', e => {
    const a = e.target.closest('[data-act],[data-st]'); if (!a) return; const v = Driver.veh(), k = a.dataset.act;
    if (a.dataset.st != null && v) { Store.set(d => { d.vehicles.find(y => y.id === v.id).status = a.dataset.st || null; }); }
    if (k === 'veh') pickVehicleDialog(() => App.refresh());
    if (k === 'start' && v) { Store.set(d => { const x = d.drivers.find(y => y.id === App.s.id); if (x) { x.onShift = true; x.since = N(); } }); st.cam = false; toast('Ride started', 'Riders can now see ' + v.id + ' live.', 'ok'); if (!P.share[v.id]) askShare(v); }
    if (k === 'end' && v) { Store.set(d => { const x = d.drivers.find(y => y.id === App.s.id); if (x) x.onShift = false; }); share(v.id, false); map.setVehicle(null); st.cam = false; }
    if (k === 'share' && v) share(v.id, !P.share[v.id]);
    if ((k === 'plus' || k === 'minus') && v) Store.set(d => { const x = d.vehicles.find(y => y.id === v.id); x.manual = clamp(onboard(x) + (k === 'plus' ? 1 : -1), 0, x.cap); x.manualAt = N(); });
    if (k === 'resolve') resolveIncident(a.dataset.id, 'Driver');
    if (k === 'recenter' && v) map.rideCam(v.id);
    if (k === 'delay' && v) ask('Report delay', ['Heavy traffic', 'Road blocked', 'Breakdown', 'Weather'], [5, 10, 15], (r, m) => { incident(v, r, `Driver reported: ${r}.`, m); toast('Delay reported', `Riders see about ${m} min later.`, 'ok'); });
    paint();
  });
  return {
    live() {
      const v = Driver.veh(), d = Driver.me(); if (v && d && d.onShift && !st.cam) { const s = vState(v); if (s.visible) { map.setVehicle(v.id); map.rideCam(v.id, true); st.cam = true; } }
      if (!$('.scrim')) { const y = body.scrollTop; paint(); body.scrollTop = y; }
    },
    onStore() { if (!$('.scrim')) paint(); }, destroy() { map.destroy(); },
  };
};

/* ---------- uploads (receipts, photos) ---------- */
const imgGet = id => { try { return localStorage.getItem('klust-plus-img-' + id); } catch (e) { return null; } };
const imgSet = (id, d) => { try { localStorage.setItem('klust-plus-img-' + id, d); return true; } catch (e) { toast('Could not save the file', 'Storage is full. Try a smaller one.'); return false; } };
const shrink = f => new Promise((ok, no) => {
  if (f.type === 'application/pdf') { if (f.size > 7e5) return no('PDF is too large (max 700 KB)'); const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); return; }
  const img = new Image(), u = URL.createObjectURL(f);
  img.onload = () => { const k = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', .72)); };
  img.onerror = () => no('Could not read that file'); img.src = u;
});
function pickFile(accept, cb) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = async () => { const f = i.files[0]; if (!f) return; try { cb(await shrink(f)); } catch (e) { toast(String(e)); } }; i.click(); }
const thumb = d => d ? (d.startsWith('data:application/pdf') ? '<span class="chip-s">PDF attached</span>' : `<img class="plus-th" src="${d}" alt="Attached photo">`) : '';
function imgDlg(id, title) { const d = imgGet(id); if (!d) { toast('No file attached'); return; } openDialog({ title, html: d.startsWith('data:application/pdf') ? `<embed src="${d}" type="application/pdf" style="width:100%;height:60vh">` : `<img src="${d}" alt="" style="max-width:100%;border-radius:10px">` }); }

/* ---------- student pass, help (issues + lost & found), admin desk ---------- */
const approve = p => { p.st = 'approved'; p.to = N() + (p.type === 'weekly' ? 7 : 30) * DAYMS; };
SCREENS.pass = el => {
  let pt = 'weekly', rc = null;
  const paint = () => {
    const u = App.s.id, mine = P.passes.filter(x => x.uid === u).sort((a, b) => b.at - a.at), act = mine.find(x => x.st === 'approved' && x.to > N()), pen = mine.find(x => x.st === 'pending');
    el.innerHTML = header('Pass', 'Student travel pass', bellBtn()) + `<div class="content narrow stack-l">
      ${act ? `<section class="card" style="text-align:center"><span class="chip-s ok">Approved</span><h3 style="margin:10px 0">${cap(act.type)} pass</h3><div id="pq" style="display:inline-block;padding:10px;background:#fff;border-radius:12px"></div><p class="num" style="margin:8px 0 2px"><b>PASS-${act.code}</b></p><p class="muted small">Show this QR to the driver when boarding</p><b>Valid until ${dt(act.to)}</b><p class="hint" style="justify-content:center">${icon('shield')}Works offline</p></section>`
      : pen ? `<section class="card"><span class="chip-s warn">Pending approval</span><p class="muted" style="margin:8px 0">Your ${pen.type} pass request is waiting for Operations.</p>${pen.img ? thumb(imgGet(pen.id)) : ''}</section>`
      : `<section class="card"><h3 style="margin-bottom:10px">Apply for a pass</h3><div class="seg">${[['weekly', 'Weekly pass'], ['monthly', 'Monthly pass']].map(([k, l]) => `<button data-t="${k}" aria-pressed="${k === pt}">${l}</button>`).join('')}</div>
        <div class="row" style="margin-top:12px;gap:10px"><button class="btn ghost grow" data-rc="1">${rc ? 'Change receipt' : 'Upload payment receipt'}</button>${rc ? thumb(rc) : ''}</div><p class="muted small" style="margin:6px 0 0">Optional. A photo or PDF of your payment helps Operations approve faster.</p>
        <button class="btn primary block" data-apply="1" style="margin-top:12px">Apply</button></section>`}
      <section class="card"><h3 style="margin-bottom:8px">Fare rules</h3><ul class="plist"><li>${icon('ticket')}<span>Weekly pass RM ${P.fare.weekly}, valid 7 days from approval</span></li><li>${icon('ticket')}<span>Monthly pass RM ${P.fare.monthly}, valid 30 days from approval</span></li><li>${icon('shield')}<span>Eligible students get ${P.fare.disc}% off single rides. Passes cannot be shared.</span></li></ul></section></div>`;
    act && renderQR($('#pq', el), 'PASS-' + act.code);
  };
  paint();
  el.onclick = e => {
    const t = e.target.closest('button'); if (!t) return; if (t.dataset.t) { pt = t.dataset.t; paint(); }
    if (t.dataset.rc) pickFile('image/*,application/pdf', d => { rc = d; paint(); });
    if (t.dataset.apply) { const id = uid('P'), p = { id, code: codeFrom('PASS' + id), uid: App.s.id, type: pt, st: 'pending', at: N() }; if (rc && imgSet(id, rc)) p.img = 1; P.passes.unshift(p); save(); rc = null; toast('Application sent', 'Operations will review it shortly.', 'ok'); paint(); }
  };
  return {};
};
SCREENS.help = el => {
  let c = CATS[0], txt = '', ph = null;
  const paint = () => {
    const mine = P.issues.filter(i => i.uid === App.s.id);
    el.innerHTML = header('Help', 'Report an issue and lost & found', bellBtn()) + `<div class="content narrow stack-l"><section class="card"><h3 style="margin-bottom:10px">Report an issue</h3><div class="chips scroll">${CATS.map(x => `<button class="chip" data-c="${x}" aria-pressed="${x === c}">${x}</button>`).join('')}</div><label class="field" style="margin-top:10px"><span>Details</span><textarea class="input" id="ht" rows="3" placeholder="What happened? Add the vehicle or stop name.">${esc(txt)}</textarea></label>
      <div class="row" style="margin-top:10px;gap:10px"><button class="btn ghost grow" data-ph="1">${ph ? 'Change photo' : 'Add a photo'}</button>${ph ? thumb(ph) : ''}</div>
      <button class="btn primary block" data-send="1" style="margin-top:10px">Submit</button></section>
      <section class="card"><h3 style="margin-bottom:8px">My reports</h3>${mine.length ? mine.map(i => `<div class="lrow static">${i.img ? thumb(imgGet(i.id)) : ''}<span class="grow"><b>${esc(i.cat)}</b><small>${esc(i.text)}</small></span><span class="chip-s ${i.st === 'resolved' ? 'ok' : i.st === 'new' ? 'warn' : ''}">${i.st === 'prog' ? 'In progress' : cap(i.st)}</span></div>`).join('') : '<p class="muted">Nothing reported yet.</p>'}</section></div>`;
  };
  paint();
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return; const t = $('#ht', el); t && (txt = t.value);
    if (b.dataset.c) { c = b.dataset.c; paint(); }
    if (b.dataset.ph) pickFile('image/*', d => { ph = d; paint(); });
    if (b.dataset.send) { if (!txt.trim()) { toast('Add a few details first'); return; } const id = uid('ISS'), i = { id, uid: App.s.id, cat: c, text: txt.trim(), st: 'new', who: '', at: N() }; if (ph && imgSet(id, ph)) i.img = 1; P.issues.unshift(i); save(); txt = ''; ph = null; toast('Report sent', 'Operations will look into it.', 'ok'); paint(); }
  };
  return {};
};
SCREENS.desk = el => {
  const nm = id => (Store.d.users[id] && Store.d.users[id].name) || id;
  const paint = () => {
    el.innerHTML = header('Desk', 'Passes, issues and lost & found', bellBtn()) + `<div class="content narrow stack-l"><section class="card"><h3 style="margin-bottom:10px">Student travel pass</h3><div class="row">${[['weekly', 'Weekly RM'], ['monthly', 'Monthly RM'], ['disc', 'Discount %']].map(([k, l]) => `<label class="field grow"><span>${l}</span><input class="input" type="number" data-f="${k}" value="${P.fare[k]}"></label>`).join('')}</div>
      ${P.passes.length ? `<div class="list card-list" style="margin-top:10px">${P.passes.slice(0, 12).map(p => `<div class="lrow static" style="flex-wrap:wrap;gap:6px"><span class="grow"><b>${esc(nm(p.uid))}</b><small>${cap(p.type)}, ${p.st}${p.st === 'approved' ? ', expires ' + dt(p.to) : ''}</small></span>${p.img ? `<button class="btn sm" data-iv="${p.id}" data-t="Payment receipt">Receipt</button>` : ''}${p.st === 'pending' ? `<button class="btn sm primary" data-pa="ok" data-id="${p.id}">Approve</button><button class="btn sm" data-pa="no" data-id="${p.id}">Reject</button>` : p.st === 'approved' ? `<button class="btn sm" data-pa="ext" data-id="${p.id}">+7 days</button><button class="btn sm" data-pa="rev" data-id="${p.id}">Revoke</button>` : ''}</div>`).join('')}</div>` : '<p class="muted" style="margin-top:8px">No pass requests yet.</p>'}</section>
      <section class="card"><h3 style="margin-bottom:8px">Issues and lost & found</h3>${P.issues.length ? P.issues.slice(0, 15).map(i => `<div class="lrow static" style="flex-wrap:wrap;gap:6px"><span class="grow"><b>${esc(i.cat)}</b> <span class="chip-s ${i.st === 'resolved' ? 'ok' : i.st === 'new' ? 'warn' : ''}">${i.st === 'prog' ? 'In progress' : cap(i.st)}</span><small>${esc(i.text)} (${esc(nm(i.uid))})</small></span>${i.img ? `<button class="btn sm" data-iv="${i.id}" data-t="Photo">Photo</button>` : ''}<select class="input" data-ic="${i.id}">${CATS.map(x => `<option ${x === i.cat ? 'selected' : ''}>${x}</option>`).join('')}</select><select class="input" data-ia="${i.id}">${TEAMS.map(x => `<option value="${x}" ${x === i.who ? 'selected' : ''}>${x || 'Unassigned'}</option>`).join('')}</select><button class="btn sm" data-is="prog" data-id="${i.id}">In progress</button><button class="btn sm primary" data-is="resolved" data-id="${i.id}">Resolve</button></div>`).join('') : '<p class="muted">No reports yet.</p>'}</section></div>`;
  };
  paint();
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return; if (b.dataset.iv) { imgDlg(b.dataset.iv, b.dataset.t); return; }
    const id = b.dataset.id, p = P.passes.find(x => x.id === id), i = P.issues.find(x => x.id === id);
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

/* ---------- languages: English, Bahasa Malaysia, Bangla (login corner + Account settings) ---------- */
const LANGS = [['en', 'English'], ['ms', 'Melayu'], ['bn', 'বাংলা']];
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
Upload payment receipt|Muat naik resit bayaran|পেমেন্টের রসিদ আপলোড করুন
Add a photo|Tambah gambar|ছবি যোগ করুন
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
Resolved|Selesai diselesaikan|সমাধান হয়েছে
Start ride|Mulakan perjalanan|যাত্রা শুরু করুন
End ride|Tamat perjalanan|যাত্রা শেষ করুন
Share live location|Kongsi lokasi langsung|লাইভ লোকেশন শেয়ার করুন
Live location ON|Lokasi langsung AKTIF|লাইভ লোকেশন চালু
Report delay|Lapor kelewatan|দেরি জানান
Passengers on board|Penumpang dalam bas|বাসে যাত্রী
Select location manually|Pilih lokasi secara manual|হাতে লোকেশন বেছে নিন
Move the map to set your location|Gerakkan peta untuk tetapkan lokasi anda|আপনার অবস্থান ঠিক করতে মানচিত্র সরান
Confirm location|Sahkan lokasi|অবস্থান নিশ্চিত করুন
Road blocked|Jalan tersekat|রাস্তা বন্ধ
Heavy traffic|Trafik sesak|তীব্র যানজট
Boarding|Menaiki|উঠছে
Now|Sekarang|এখন
Language|Bahasa|ভাষা
Demo mode|Mod demo|ডেমো মোড
Simulation|Simulasi|সিমুলেশন
Offline mode|Mod luar talian|অফলাইন মোড`.split('\n').forEach(l => { const [a, b, c] = l.split('|'); DX[a] = [b, c]; });
const PAT = [[/^(\d+) min$/, ['$1 min', '$1 মিনিট']], [/^Route (\S+) running about (\d+) min late$/, ['Laluan $1 lewat kira-kira $2 min', 'রুট $1 প্রায় $2 মিনিট দেরিতে']], [/^Valid until (.+)$/, ['Sah sehingga $1', 'মেয়াদ $1 পর্যন্ত']]];
const tr = k => { const i = LI[P.lang]; if (i == null) return null; const e = DX[k]; if (e) return e[i]; for (const [re, t] of PAT) if (re.test(k)) return k.replace(re, t[i]); return null; };
const t1 = n => { const o = O.has(n) ? O.get(n) : n.nodeValue, k = o.trim(), t = k && tr(k); if (t) { O.set(n, o); n.nodeValue = o.replace(k, t); } };
const texts = r => { const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT), a = []; let n; while (n = w.nextNode()) a.push(n); return a; };
function setLang(l) { P.lang = l; save(); texts(document.body).forEach(n => { if (O.has(n)) { n.nodeValue = O.get(n); O.delete(n); } }); document.documentElement.lang = l; texts(document.body).forEach(t1); $$('[data-l]').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === l)); }

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

/* ---------- demo simulation (admin switches it on in Account; only admins see the event feed) ---------- */
const NM = ['Aisha', 'Hafiz', 'Nurul', 'Farid', 'Siti', 'Rahim', 'Tanvir', 'Mei Ling', 'Arjun', 'Sumaiya', 'Daniel', 'Faiz'], WID = Math.random().toString(36).slice(2), LK = 'klust-plus-lead';
const TXT = { Cleanliness: ['Seat was sticky on the morning trip.', 'Rubbish left on the floor.'], 'Driver feedback': ['Very polite driver today, thank you.', 'Bus left a minute early.'], 'Stop feedback': ['No seating at the stop.', 'Stop light is broken.'], 'Lost item': ['Blue umbrella left on the bus.', 'Lost my student card.'], 'Found item': ['Found a water bottle on the back seat.'], Other: ['AC was too cold.'] };
let shown = (P.feed || [])[0], st = null;
function showFeed() {
  const f = $('.plus-feed'); if (f) f.innerHTML = (P.feed || []).map(esc).join('<br>');
  if (App.s && App.s.role === 'admin' && P.feed[0] && P.feed[0] !== shown) toast(P.feed[0], '', '', 2400); shown = P.feed[0];
}
const feed = t => { P.feed = [t, ...(P.feed || [])].slice(0, 8); save(); showFeed(); };
function runSim(on) { clearInterval(st); st = null; if (on) st = setInterval(simTick, 3500); }
function sim(on) {
  P.sim = on ? 1 : 0; save(); runSim(on);
  if (on) { Store.set(d => { d.settings.ignoreDays = d.settings.ignoreHours = true; d.drivers.forEach(x => { x.onShift = true; x.since = x.since || N(); }); }); simTick(); }
}
function detourNow() {
  const vs = Store.d.vehicles.filter(v => { const s = vState(v); return s && s.visible && s.w.mode === 'travel' && !P.det[v.id]; });
  if (!vs.length) { toast('No vehicle can change road right now', 'Try again in a moment.'); return; }
  const v = rp(vs), c = rp(['Road blocked', 'Flooding', 'Accident ahead']);
  reroute(v, c, viaFn).then(x => x ? feed(`${v.id} took another road (${c}), about ${x} min later`) : toast('Could not find another road', 'Check the internet connection.'));
}
function simTick() {
  let L = null; try { L = JSON.parse(localStorage.getItem(LK)); } catch (e) { }
  if (L && L.id !== WID && N() - L.at < 9e3) return; try { localStorage.setItem(LK, JSON.stringify({ id: WID, at: N() })); } catch (e) { }
  const vs = Store.d.vehicles.filter(v => { const s = vState(v); return s && s.visible; }); if (!vs.length) return;
  const v = rp(vs), s = vState(v), sp = STOPS[rp(s.r.stops)], stop = sp.short || sp.name, x = Math.random(), d = P.delta, cur = d[v.id] || 0;
  const open = Store.d.incidents.some(i => i.vehicle === v.id && i.status !== 'resolved');
  if (x < .45 && cur < 25) { const n = 1 + Math.floor(Math.random() * 3); d[v.id] = cur + n; feed(`${rp(NM)}${n > 1 ? ' and ' + (n - 1) + ' more' : ''} boarded ${v.id} at ${stop}`); }
  else if (x < .66) { d[v.id] = Math.max(-15, cur - 1 - Math.floor(Math.random() * 3)); feed(`Students got off ${v.id} at ${stop}`); }
  else if (x < .72 && !open) { const m = 3 + Math.floor(Math.random() * 6), c = rp(['Heavy traffic', 'Weather', 'Road works']); incident(v, c, `${c} slowing ${v.id}.`, m); feed(`${v.id} delayed ${m} min: ${c}`); }
  else if (x < .78 && s.w.mode === 'travel' && !P.det[v.id] && !open) { const c = rp(['Road blocked', 'Flooding', 'Accident ahead']); reroute(v, c, viaFn).then(e => e && feed(`${v.id} took another road (${c}), about ${e} min later`)); }
  else if (x < .89) { const c = rp(CATS), u = rp(Object.keys(Store.d.users)); P.issues.unshift({ id: uid('ISS'), uid: u, cat: c, text: rp(TXT[c]), st: 'new', who: '', at: N() }); feed(`New report: ${c}`); }
  else { const u = rp(Object.keys(Store.d.users)); if (!P.passes.some(p => p.uid === u && p.st === 'pending')) { const id = uid('P'); P.passes.unshift({ id, code: codeFrom('PASS' + id), uid: u, type: rp(['weekly', 'monthly']), st: 'pending', at: N() }); feed(`${(Store.d.users[u] || {}).name || u} applied for a pass`); } }
  P.passes.filter(p => p.st === 'pending' && N() - p.at > 9e3 && Math.random() < .5).forEach(approve);
  P.issues.filter(i => i.st !== 'resolved' && N() - i.at > 45e3 && Math.random() < .3).forEach(i => { i.st = i.st === 'new' ? 'prog' : 'resolved'; i.who = i.who || rp(TEAMS.slice(1)); });
  Store.d.incidents.filter(i => i.status !== 'resolved' && i.kind === 'delay' && N() - i.at > 80e3).forEach(i => resolveIncident(i.id, 'Operations'));
  P.passes = P.passes.slice(0, 40); P.issues = P.issues.slice(0, 40); save();
  if (['pass', 'help', 'desk'].includes(App.tab) && !App.busy()) App.refresh();
}

/* ---------- Account settings (language for everyone, demo mode for admin) + login corner ---------- */
const accHTML = () => `<h3 style="margin-bottom:10px">Language</h3><div class="seg">${LANGS.map(([k, l]) => `<button data-l="${k}" aria-pressed="${P.lang === k}">${l}</button>`).join('')}</div>${App.s && App.s.role === 'admin' ? `
  <h3 style="margin:18px 0 4px">Demo mode</h3><p class="muted small" style="margin-bottom:10px">Runs a live simulation for presentations. Students and drivers only see what affects them, such as how full a vehicle is and delays.</p>
  <div class="row between" style="margin-bottom:8px"><b>Simulation</b><button class="btn sm ${P.sim ? 'primary' : ''}" data-sim="1">${P.sim ? 'On' : 'Off'}</button></div>
  <div class="row between" style="margin-bottom:8px"><b>Offline mode</b><button class="btn sm ${P.off ? 'primary' : ''}" data-off="1">${P.off ? 'On' : 'Off'}</button></div>
  <button class="btn ghost block" data-det="1">Send a bus on another road</button><p class="small muted plus-feed" style="margin-top:10px;max-height:110px;overflow:auto">${(P.feed || []).map(esc).join('<br>')}</p>` : ''}`;
function shellUI() {
  if (App.s && App.tab === 'account') { const c = $('#screen .content'); if (c && !$('.plus-acc', c)) { const sec = document.createElement('section'); sec.className = 'card plus-acc'; sec.innerHTML = accHTML(); const so = $('[data-act="signout"]', c); so ? c.insertBefore(sec, so) : c.appendChild(sec); } }
  const lg = $('.login'); let e = $('.plus-lang');
  if (!lg) e && e.remove(); else if (!e) { e = document.createElement('div'); e.className = 'plus-lang'; e.innerHTML = `<div class="seg sm">${LANGS.map(([k, l]) => `<button data-l="${k}" aria-pressed="${P.lang === k}">${l}</button>`).join('')}</div>`; document.body.appendChild(e); }
  const c = $('#plus-chip'); if (c && ![...MAPS].some(m => m.box.isConnected)) c.remove();
}
document.addEventListener('click', e => {
  const b = e.target.closest('.plus-acc button, .plus-lang button'); if (!b) return; const d = b.dataset;
  if (d.l) setLang(d.l);
  if (d.sim) sim(!P.sim);
  if (d.off) { P.off = P.off ? 0 : 1; save(); if (!P.off && navigator.onLine) online(); else toast('Offline mode on', 'Saved tickets, passes and passenger lists still work.'); offUI(); }
  if (d.det) detourNow();
  $$('.plus-acc').forEach(s => s.innerHTML = accHTML());
});
let q = new Set(), qt = 0;
new MutationObserver(ms => {
  ms.forEach(m => m.addedNodes.forEach(n => q.add(n)));
  if (!qt) qt = requestAnimationFrame(() => { qt = 0; if (P.lang !== 'en') q.forEach(n => { if (!n.isConnected) return; n.nodeType === 3 ? t1(n) : n.nodeType === 1 && texts(n).forEach(t1); }); q = new Set(); shellUI(); });
}).observe(document.body, { childList: true, subtree: true });
addEventListener('storage', e => {
  if (e.key !== PK) return; const was = P.sim, lang = P.lang;
  try { Object.assign(P, JSON.parse(e.newValue)); } catch (x) { } P.lang = lang;
  if (!!was !== !!P.sim) runSim(P.sim); showFeed();
  if (['pass', 'help', 'desk'].includes(App.tab) && !App.busy()) App.refresh();
});
setInterval(() => { if (!offline()) P.sync = N(); offUI(); }, 1000);
if (P.sim) runSim(true);
if (App.s) App.render(false);
if (P.lang !== 'en') setLang(P.lang);
shellUI();
})();
