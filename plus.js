/* KLUST Shuttle PLUS - add-on loaded after the main script.
   Adds: my-location button, embedded driver trip map, GPS off-route incidents + road routing,
   student pass receipts, issue/lost-found photos, EN/BM/BN, offline mode, draggable manual location, admin-only demo preview. */
(() => {
'use strict';
const PK = 'klust-plus-v1', DAYMS = 864e5;
const P = { lang: 'en', share: {}, live: {}, det: {}, issues: [], passes: [], pq: [], delta: {}, demo: false, sim: 0, off: 0, sync: Date.now(), fare: { weekly: 8, monthly: 25, disc: 30 } };
try { Object.assign(P, JSON.parse(localStorage.getItem(PK))); } catch (e) { }
Object.keys(P.det || {}).forEach(id => { if (!P.det[id] || !P.det[id].target || !Array.isArray(P.det[id].ll) || P.det[id].ll.length < 2) delete P.det[id]; });
P.delta = {}; // legacy fake passenger deltas are not part of production tracking
const save = () => { try { localStorage.setItem(PK, JSON.stringify(P)); } catch (e) { } };
save();
const N = () => Date.now(), offline = () => P.off || !navigator.onLine;
const cap = s => s[0].toUpperCase() + s.slice(1), rp = a => a[Math.floor(Math.random() * a.length)];
const dt = ts => new Date(ts).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
function readPhoto(file, maxSide = 900) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) { reject(new Error('Choose an image file.')); return; }
    if (file.size > 20 * 1024 * 1024) { reject(new Error('Image is too large. Choose one under 20 MB.')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try { const scale = Math.min(1, maxSide / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', .62)); }
      catch (e) { reject(e); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}
const ez = f => .65 * f + .35 * (f < .5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2);
const served = () => [...new Set(liveRoutes().flatMap(r => r.stops))];
const CATS = ['Cleanliness', 'Driver feedback', 'Stop feedback', 'Lost item', 'Found item', 'Other'], TEAMS = ['', 'Cleaning team', 'Transport office', 'Lost & found desk'];

/* ---------- styles ---------- */
const css = document.createElement('style');
css.textContent = `.plus-tools{position:fixed;left:12px;bottom:calc(var(--nav-h,64px) + 14px);z-index:70}.plus-fab{height:40px;padding:0 14px;border-radius:20px;background:var(--primary);color:var(--on-primary);font:700 13px var(--font);box-shadow:var(--sh-2)}
.plus-menu{position:absolute;left:0;bottom:48px;width:270px;background:var(--surface);color:var(--ink);border-radius:14px;box-shadow:var(--sh-3);padding:14px;display:grid;gap:10px;font:500 13px var(--font)}.plus-menu small{color:var(--muted);display:block;max-height:92px;overflow:auto}
.plus-chip{position:fixed;left:12px;right:12px;top:max(72px,calc(env(safe-area-inset-top) + 62px));z-index:130;background:var(--surface);color:var(--ink);border-radius:12px;box-shadow:var(--sh-2);padding:10px 12px;font-size:13px;display:grid;gap:5px;overflow:visible;pointer-events:auto;width:auto;max-width:460px;margin:0 auto}.plus-chip span{color:var(--muted);line-height:1.4}.plus-chip .btn{justify-self:start;max-width:100%;margin-top:2px}.plus-chip b{line-height:1.35}
.plus-off{position:fixed;top:0;left:0;right:0;z-index:95;background:var(--warn-bg);color:var(--warn);font:700 12px var(--font);padding:6px 12px;text-align:center}.plus-off.old{background:var(--danger-bg);color:var(--danger)}
.plus-fabr{position:fixed;right:14px;bottom:calc(var(--nav-h,64px) + 14px);z-index:70}
.plus-login-lang{position:fixed;top:max(10px,env(safe-area-inset-top));right:12px;z-index:120}.plus-login-lang select{appearance:none;max-width:148px;height:31px;border:1px solid var(--line);border-radius:9px;padding:0 24px 0 9px;background:var(--surface);color:var(--ink);box-shadow:var(--sh-2);font:700 11.5px var(--font);background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 12px) 12px,calc(100% - 8px) 12px;background-size:4px 4px,4px 4px;background-repeat:no-repeat}
.manual-map-host{height:min(48vh,430px);min-height:260px;position:relative;overflow:hidden;border-radius:14px;background:var(--surface-2);margin:10px 0 12px}.manual-map-host .smap{position:absolute;inset:0;width:100%;height:100%}.manual-pin-anchor{width:0;height:0;z-index:30;pointer-events:none}.manual-pin{pointer-events:auto;display:grid;place-items:center;width:42px;height:48px;background:transparent;color:#2563eb;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28));touch-action:none;cursor:grab;border:0;padding:0;transform:translate(-50%,-100%)}.manual-pin:active{cursor:grabbing}.manual-pin .ico{width:38px;height:38px;stroke:#fff;fill:#2563eb;stroke-width:1.7}.pdrv-map-shell{position:relative;height:min(47vh,500px);min-height:300px;overflow:hidden;border-radius:16px;background:var(--surface-2)}.pdrv-map-shell>.smap{position:absolute;inset:0;width:100%;height:100%}.pdrv-map-pill{position:absolute;top:10px;left:10px;z-index:20;background:var(--surface);padding:8px 10px;border-radius:12px;box-shadow:var(--sh-2);font-size:12px;font-weight:750;max-width:calc(100% - 20px)}.pdrv-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.pdrv-detail{margin-top:14px}.pdrv-next{display:grid;grid-template-columns:1fr auto;gap:5px 14px;align-items:center;margin-bottom:12px}.pdrv-next strong{font-size:16px}.pdrv-next .pdrv-eta{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}.pdrv-stop-list{margin-top:12px}.pdrv-actions .btn{min-width:0;padding:0 10px}.pdrv-photo{max-width:100%;max-height:240px;display:block;object-fit:contain;border-radius:10px;margin-top:8px;border:1px solid var(--line)}`;
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
window.onboard = (v, t = N()) => _ob(v, t);

function incident(v, cat, details, delay, silent = false) {
  const r = routeById(v.route), now = N();
  Store.set(d => {
    const y = d.vehicles.find(z => z.id === v.id);
    d.incidents.unshift({ id: uid('INC'), kind: 'delay', cat, details, vehicle: v.id, route: r ? r.id : null, driver: v.driver, at: now, status: 'open', delay, affected: onboard(v), photo: null, demo: !!silent });
    setHold(y, now + delay * MIN);
    if (r && !silent) notify(d, { role: 'student', routes: [r.id] }, 'warn', `Route ${r.id.slice(1)} running about ${delay} min late`, `${cat} affecting ${v.id}. Route and arrival times have been updated.`);
    addLog(d, 'incident', `${silent ? '[Demo] ' : ''}${cat} incident on ${v.id}`);
  });
}
const DIST_KM = (a, b) => { const rad = x => x * Math.PI / 180, dy = rad(b.lat - a.lat), dx = rad(b.lng - a.lng), q = Math.sin(dy / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dx / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(q)); };
const inSegKm = (p, a, b) => {
  const cos = Math.cos(p.lat * Math.PI / 180), xy = q => [(q.lng - p.lng) * 111.32 * cos, (q.lat - p.lat) * 110.57];
  const A = xy(a), B = xy(b), dx = B[0] - A[0], dy = B[1] - A[1], den = dx * dx + dy * dy || 1, t = clamp(-(A[0] * dx + A[1] * dy) / den, 0, 1);
  return Math.hypot(A[0] + t * dx, A[1] + t * dy);
};
function routeDistanceKm(p, ll) { let best = Infinity; for (let i = 1; i < ll.length; i++) best = Math.min(best, inSegKm(p, { lat: ll[i - 1][0], lng: ll[i - 1][1] }, { lat: ll[i][0], lng: ll[i][1] })); return best; }
const rerouting = new Set(), deviationTicks = {};
async function reroute(v, why, options = {}) {
  const s = vState(v); if (!s || !s.visible || s.w.mode !== 'travel') {
    incident(v, 'Route deviation', `Route deviation reported (${why}). A road re-route could not be calculated because the shuttle is not between stops.`, 5, !!options.silent);
    if (!options.automatic) toast('Route deviation incident recorded', 'The incident is logged. A road re-route can be calculated once the shuttle is between stops.');
    return false;
  }
  if (rerouting.has(v.id)) return false;
  rerouting.add(v.id);
  const r = s.r, p = window.vPos(s) || _vp(s), sid = r.stops[(s.w.leg + 1) % r.stops.length], b = STOPS[sid];
  let ll = null, actualMin = null;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
    const url = `https://router.project-osrm.org/route/v1/driving/${p.lng},${p.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=false&alternatives=false`;
    const res = await fetch(url, { signal: ctl.signal }); clearTimeout(timer);
    const j = await res.json();
    if (!res.ok || !j || j.code !== 'Ok' || !j.routes || !j.routes[0] || !j.routes[0].geometry || !j.routes[0].geometry.coordinates || j.routes[0].geometry.coordinates.length < 2) throw new Error('No road route was returned');
    ll = j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); actualMin = Math.max(1, j.routes[0].duration / 60);
  } catch (e) {
    const delay = 5;
    incident(v, 'Route deviation', `Route deviation reported (${why}). Automatic road routing to ${b.name} was unavailable; GPS tracking remains active.`, delay, !!options.silent);
    if (!options.silent) toast('Route deviation incident recorded', 'Live GPS remains updated. Road directions are temporarily unavailable.');
    rerouting.delete(v.id); return false;
  }
  const normalMin = Math.max(2, (r.legs[s.w.leg] || 8) * (1 - s.w.f));
  const extra = clamp(Math.ceil(actualMin - normalMin), 3, 20);
  P.det[v.id] = { leg: s.w.leg, f0: s.w.f, ll, why, extra, at: N(), target: sid, demo: !!options.silent }; delete G[v.id]; save();
  incident(v, 'Route deviation', `Route deviation incident: ${why}. Rerouted along available roads toward ${b.name}.`, extra, !!options.silent);
  rerouting.delete(v.id); MAPS.forEach(m => { if (m.box.isConnected) { over(m); if (m.followV === v.id) m.rideCam(v.id); } });
  return true;
}
let wid = null;
function share(vid, on) {
  if (on && !navigator.geolocation) { P.share[vid] = false; save(); toast('GPS not supported', 'This browser cannot share live location. The scheduled vehicle position will be shown.', 'danger'); return; }
  P.share[vid] = !!on; save(); if (wid != null) { navigator.geolocation.clearWatch(wid); wid = null; }
  if (on) wid = navigator.geolocation.watchPosition(g => {
    const o = P.live[vid], la = g.coords.latitude, ln = g.coords.longitude, [x, y] = merc(la, ln); let ang = o ? o.ang : 0;
    if (o) { const [x0, y0] = merc(o.lat, o.lng); if (Math.hypot(x - x0, y - y0) > 2e-7) ang = Math.atan2(y - y0, x - x0) * 180 / Math.PI; }
    P.live[vid] = { lat: la, lng: ln, at: N(), ang }; save();
    checkLiveDeviation(vid, { lat: la, lng: ln });
  }, () => { P.share[vid] = false; save(); if (wid != null) { navigator.geolocation.clearWatch(wid); wid = null; } toast('GPS not available', 'Live tracking was turned off; showing the scheduled position instead.'); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });
  toast(on ? 'Live location is ON' : 'Live location is OFF', on ? 'Riders can see this vehicle on the map.' : 'Your personal location stays private.', on ? 'ok' : '');
}
function checkLiveDeviation(vid, p) {
  const v = vehicleById(vid); if (!v || rerouting.has(vid)) return;
  const s = vState(v); if (!s || !s.visible || s.w.mode !== 'travel') { deviationTicks[vid] = 0; return; }
  const a = s.r.stops[s.w.leg], b = s.r.stops[(s.w.leg + 1) % s.r.stops.length];
  // A diversion applies only to its current leg. On reaching the next leg, discard it
  // and resume monitoring against the normal route geometry.
  if (P.det[vid] && P.det[vid].leg !== s.w.leg) { delete P.det[vid]; delete G[vid]; save(); deviationTicks[vid] = 0; }
  const active = P.det[vid] && P.det[vid].leg === s.w.leg ? P.det[vid] : null;
  if (!active && !Geo.has(a, b)) return; // Avoid false alarms before road geometry loads.
  const monitoredPath = active ? active.ll : Geo.legLL(a, b);
  const distance = routeDistanceKm(p, monitoredPath);
  if (distance > .12) deviationTicks[vid] = (deviationTicks[vid] || 0) + 1; else deviationTicks[vid] = 0;
  if (deviationTicks[vid] >= 3) {
    deviationTicks[vid] = 0;
    reroute(v, active ? 'GPS detected the shuttle off its active diversion route' : 'GPS detected the shuttle off its planned route', { automatic: true }).then(ok => {
      if (ok) toast('Route deviation detected', 'An incident was logged and a road-following route and updated ETA are now shown.', 'warn');
    });
  }
}
// Driver location sharing is started explicitly from the Trip map, never automatically at login.
{ const p = pickVehicleDialog; window.pickVehicleDialog = cb => p(() => { cb && cb(); }); }

/* ---------- map layer: my-location button, walking route, detour lines ---------- */
const MAPS = new Set(), SM = ShuttleMap.prototype;
function over(m) {
  const vp = m.map.vp; $$('.plus', vp).forEach(n => n.remove());
  const add = (ll, st) => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('class', 'plus'); p.setAttribute('fill', 'none'); p.setAttribute('style', st + ';vector-effect:non-scaling-stroke;stroke-linecap:round'); p.setAttribute('d', 'M' + ll.map(q => m.map.toVec(q[0], q[1]).map(x => x.toFixed(1)).join(' ')).join('L')); vp.appendChild(p); };
  Object.values(P.det).forEach(d => add(d.ll, 'stroke:#f59e0b;stroke-width:5;stroke-dasharray:10 6'));
  if (m._walk) add(m._walk.ll, 'stroke:#2563eb;stroke-width:4;stroke-dasharray:1 8');
}
function chip(m, html) {
  let c = $('.plus-chip', m.box); if (!html) { c && c.remove(); return; }
  if (!c) { c = document.createElement('div'); c.className = 'plus-chip'; m.box.appendChild(c); c.onclick = e => { if (e.target.closest('[data-man]')) manual(m); }; } c.innerHTML = html;
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
  try { await Locate.get(); } catch (e) { chip(m, `<b>Can\u2019t find your location</b><span>${esc(Locate.err(e))}</span><button class="btn sm" data-man>${icon('pin')} Select location manually</button>`); }
}
function manual(sourceMap) {
  const start = Locate.last || (sourceMap && sourceMap.um ? { lat: sourceMap.um.lat, lng: sourceMap.um.lng } : STOPS[HUB]);
  let point = { lat: start.lat, lng: start.lng };
  let map = null, marker = null, dragging = false;
  const dlg = openDialog({ title: 'Set your location', wide: true, html: `<p class="muted small" style="margin:-5px 0 0">Drag the blue location pin to your exact position, just like a ride-hailing app. The pin stays on this device.</p><div class="manual-map-host" id="manualMapHost"></div><p class="small muted" style="margin:0 0 12px">Move the map if needed, then place the pin and tap Use this location.</p><button class="btn primary block" data-usepin>Use this location</button>`, onMount: (body, close) => {
    const host = $('#manualMapHost', body); map = new ShuttleMap(host, { padding: () => ({ top: 35, right: 30, bottom: 35, left: 30 }) });
    const [x, y] = merc(point.lat, point.lng); map.map.flyTo(x, y, 15, 0);
    const anchor = document.createElement('div'); anchor.className = 'manual-pin-anchor'; anchor.innerHTML = `<button type="button" class="manual-pin" aria-label="Drag to set your location">${icon('pin')}</button>`;
    marker = map.map.addMarker(anchor, point.lat, point.lng); const pin = $('.manual-pin', anchor);
    const update = ev => { const rect = map.map.el.getBoundingClientRect(), [mx, my] = map.map.screenToM(ev.clientX - rect.left, ev.clientY - rect.top), ll = unmerc(mx, my); point = { lat: ll[0], lng: ll[1] }; marker.lat = point.lat; marker.lng = point.lng; map.map.drawMarkers(); };
    pin.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); dragging = true; try { pin.setPointerCapture(ev.pointerId); } catch (x) { } });
    pin.addEventListener('pointermove', ev => { if (!dragging) return; ev.preventDefault(); ev.stopPropagation(); update(ev); });
    const endDrag = ev => { if (!dragging) return; dragging = false; ev.preventDefault(); ev.stopPropagation(); update(ev); };
    pin.addEventListener('pointerup', endDrag); pin.addEventListener('pointercancel', endDrag);
    body.addEventListener('click', e => { if (!e.target.closest('[data-usepin]')) return; const pos = { ...point, acc: 0, at: N(), manual: true }; Locate.last = pos; close(); MAPS.forEach(m => m.box.isConnected && useLoc(m, pos)); });
  } });
  const watch = new MutationObserver(() => { if (!dlg.el.isConnected) { watch.disconnect(); map && map.destroy(); } }); watch.observe(document.body, { childList: true, subtree: true });
}

/* ---------- driver: start ride (live tracking view) ---------- */
function ask(title, reasons, mins, cb) {
  let r = reasons[0], m = mins ? mins[0] : 0;
  const dlg = openDialog({ title, html: `<div class="chips scroll">${reasons.map(x => `<button class="chip" data-r="${x}" aria-pressed="${x === r}">${x}</button>`).join('')}</div>${mins ? `<div class="chips scroll" style="margin-top:8px">${mins.map(x => `<button class="chip" data-m="${x}" aria-pressed="${x === m}">${x} min</button>`).join('')}</div>` : ''}<button class="btn primary block" data-go="1" style="margin-top:14px">Send</button>`, onMount: (b, close) => b.addEventListener('click', e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.r) { r = t.dataset.r; $$('[data-r]', b).forEach(x => x.setAttribute('aria-pressed', x === t)); } if (t.dataset.m) { m = +t.dataset.m; $$('[data-m]', b).forEach(x => x.setAttribute('aria-pressed', x === t)); } if (t.dataset.go) { close(); cb(r, m); } }) });
}

/* ---------- Driver trip: embedded live map + ride details ---------- */
SCREENS.trip = el => {
  let map = null, detailOpen = false, paintedV = null;
  const paint = (force = false) => {
    if (!force && App.busy() && $('#screen') && $('#screen').contains(document.activeElement)) return;
    const d = Driver.me(), v = Driver.veh();
    if (!v) {
      if (map) { map.destroy(); map = null; }
      el.innerHTML = header('Trip', '', bellBtn()) + `<div class="content narrow">${emptyState('bus', 'No vehicle assigned', 'Ask fleet operations to assign you a vehicle.')}</div>`;
      return;
    }
    if (!el.querySelector('.pdrv-map-shell') || paintedV !== v.id) {
      if (map) map.destroy(); map = null; paintedV = v.id;
      el.innerHTML = header('Trip', `${esc(v.id)}, ${esc(v.plate)}`, bellBtn()) + `<div class="content narrow stack-l">
        <section class="card"><div class="pdrv-map-shell" id="pdrvMapShell"><div class="pdrv-map-pill" id="pdrvMapPill"></div></div><div class="pdrv-actions" id="pdrvActions"></div></section>
        <div id="pdrvDetails"></div>
      </div>`;
      map = new ShuttleMap($('#pdrvMapShell', el), { selVehicle: v.id, padding: () => ({ top: 52, right: 38, bottom: 78, left: 38 }) });
      if (vState(v).visible) map.rideCam(v.id, true); else map.setVehicle(v.id);
    }
    const r = routeById(v.route), s = vState(v), ns = s.visible ? nextStop(v) : null;
    const tracked = !!P.share[v.id], load = onboard(v), status = vehicleStatus(v);
    const open = Store.d.incidents.find(i => i.vehicle === v.id && i.status !== 'resolved' && !i.demo);
    const pill = $('#pdrvMapPill', el);
    if (pill) pill.innerHTML = `<span class="row" style="gap:8px;align-items:center">${r ? badge(r, 'xs') : ''}<b>${esc(v.id)}</b><span class="chip-s ${tracked ? 'ok' : ''}">${tracked ? '<span class=\"live-dot\"></span> Live GPS' : (s.visible ? 'Scheduled location' : 'Not running')}</span></span>`;
    const actions = $('#pdrvActions', el);
    if (actions) actions.innerHTML = `<button class="btn ${tracked ? 'danger-t ghost' : 'primary'} block" data-trip="${tracked ? 'end' : 'start'}">${tracked ? icon('power') + 'End ride' : icon('bus') + 'Start ride'}</button><button class="btn ghost block" data-trip="details">${icon(detailOpen ? 'up' : 'down')}${detailOpen ? 'Hide ride details' : 'Ride details'}</button>`;
    const details = $('#pdrvDetails', el); if (!details) return;
    if (!detailOpen) { details.innerHTML = ''; return; }
    const eta = ns ? (ns.at ? (isFinite(ns.dep) ? `Depart in ${Math.max(1, Math.round(ns.dep))} min` : 'Holding at stop') : `${etaText(ns.min)}${isFinite(ns.min) ? ` · ${fmtTime(Date.now() + ns.min * MIN)}` : ''}`) : '—';
    const order = r && ns ? r.stops.map((_, i) => r.stops[(r.stops.indexOf(ns.sid) + i) % r.stops.length]) : [];
    details.innerHTML = `<section class="card pdrv-detail">
        <div class="pdrv-next"><div><small>${ns && ns.at ? 'At stop' : 'Next stop'}</small><br><strong>${ns && ns.sid ? esc(STOPS[ns.sid].name) : esc(s.why || 'Not running')}</strong><div class="small muted">${r ? `Route ${esc(r.id.slice(1))} · ${esc(r.name)}` : 'No route assigned'}</div></div><div class="pdrv-eta">${ns ? (ns.at ? 'Here' : esc(etaText(ns.min))) : '—'}</div></div>
        <div class="row between" style="margin:4px 0 12px"><span class="small muted">${ns ? eta : (s.why || 'Waiting for service')}</span><span class="chip-s ${status.cls}">${esc(status.text)}</span></div>
        ${open ? `<div class="dh-inc ${open.kind}" style="margin-bottom:12px">${icon(open.kind === 'emergency' ? 'siren' : 'clock')}<span class="grow">${open.kind === 'emergency' ? 'Emergency reported.' : `Incident active · ${esc(open.cat)} · ${open.delay} min`}</span><button class="btn sm" data-trip="resume" data-id="${open.id}">Resolve</button></div>` : ''}
        <div class="row between"><div><small>Passenger count</small><div class="num" style="font-size:22px;font-weight:800">${load} <span class="muted small">/ ${v.cap}</span></div></div><div class="row"><button class="iconbtn" data-trip="minus" aria-label="Decrease passenger count">${icon('minus')}</button><button class="iconbtn primary" data-trip="plus" aria-label="Increase passenger count">${icon('plus')}</button></div></div>
        <div class="pdrv-actions"><button class="btn ghost block" data-trip="route-incident">${icon('route')}Report route incident</button><button class="btn ghost block" data-trip="delay">${icon('clock')}Report delay</button></div>
        <div class="list card-list" style="margin-top:14px"><div class="lrow static"><span class="grow"><b>Vehicle status</b><small>Update the service status</small></span><select class="input sm" data-trip-status aria-label="Vehicle status">${[['service','In service'],['full','Full'],['out','Out of service']].map(([k,l])=>`<option value="${k}" ${v.status===k?'selected':''}>${l}</option>`).join('')}</select></div></div>
        ${r && s.visible ? `<div class="pdrv-stop-list"><h3 style="margin:0 0 8px">Stops and ETA</h3><ol class="tl" style="--c:${r.color}">${order.map((sid,i)=>{ const m=etaFor(v,sid); return `<li class="${i===0?'next':''}"><b>${esc(STOPS[sid].name)}</b><small>${i===0 && ns.at ? 'Here now' : `${etaText(m)}${isFinite(m) ? ` · ${fmtTime(Date.now()+m*MIN)}` : ''}`}</small></li>`; }).join('')}</ol></div>` : `<p class="hint" style="margin-top:12px">${esc(s.why || 'Start the ride during service hours to show live route ETAs.')}</p>`}
      </section>`;
  };
  paint();
  el.onclick = e => {
    const b = e.target.closest('button[data-trip]'); if (!b) return;
    const action = b.dataset.trip, v = Driver.veh(); if (!v && action !== 'details') return;
    if (action === 'details') { detailOpen = !detailOpen; paint(); return; }
    if (action === 'start') {
      Store.set(d => { const x = d.drivers.find(y => y.id === App.s.id); if (x && !x.onShift) { x.onShift = true; x.since = N(); addLog(d, 'shift', `${x.name} started a ride on ${v.id}`); } });
      share(v.id, true); if (map && vState(v).visible) map.rideCam(v.id, true); paint(); return;
    }
    if (action === 'end') {
      share(v.id, false);
      Store.set(d => { const x = d.drivers.find(y => y.id === App.s.id); if (x && x.onShift) { x.onShift = false; addLog(d, 'shift', `${x.name} ended a ride on ${v.id}`); } });
      if (map) map.setVehicle(v.id); paint(); return;
    }
    if (action === 'plus' || action === 'minus') { Store.set(d => { const x = d.vehicles.find(y => y.id === v.id); x.manual = clamp(onboard(x) + (action === 'plus' ? 1 : -1), 0, x.cap); x.manualAt = N(); }); paint(); return; }
    if (action === 'route-incident') { ask('Report route incident', ['Wrong turn', 'Road blocked', 'Accident avoidance', 'Road closure', 'Flooding'], null, reason => { const liveV = Driver.veh(); reroute(liveV, reason).then(ok => { if (ok) { toast('Route incident recorded', 'The shuttle is now following the available road route; map position and ETA will update.', 'ok'); if (map) map.rideCam(liveV.id); } }); }); return; }
    if (action === 'delay') { ask('Report delay', ['Heavy traffic', 'Road blocked', 'Breakdown', 'Weather'], [5, 10, 15], (reason, mins) => { incident(v, reason, `Driver reported: ${reason}.`, mins); toast('Delay reported', `Riders will see an updated ETA of about ${mins} minutes later.`, 'ok'); paint(); }); return; }
    if (action === 'resume') { resolveIncident(b.dataset.id, Driver.me().name); toast('Incident resolved', 'The route status has been updated.', 'ok'); paint(); }
  };
  el.onchange = e => {
    const t = e.target;
    if (t.matches('[data-trip-status]')) { const v = Driver.veh(); if (!v) return; Store.set(d => { const x = d.vehicles.find(y => y.id === v.id); x.status = t.value; addLog(d, 'status', `${x.id} set to ${t.value}`); }); paint(true); }
  };
  return { live: () => paint(false), onStore: () => paint(true), destroy() { if (map) { map.destroy(); map = null; } } };
};

/* ---------- student pass, help (issues + lost & found), admin desk ---------- */
const approve = p => { p.st = 'approved'; p.to = N() + (p.type === 'weekly' ? 7 : 30) * DAYMS; };
SCREENS.pass = el => {
  let pt = 'weekly', receipt = null;
  const paint = () => {
    const u = App.s.id, mine = P.passes.filter(x => x.uid === u).sort((a, b) => b.at - a.at), act = mine.find(x => x.st === 'approved' && x.to > N()), pen = mine.find(x => x.st === 'pending');
    const receiptPass = pen || act;
    el.innerHTML = header('Pass', 'Student travel pass', bellBtn()) + `<div class="content narrow stack-l">
      ${act ? `<section class="card" style="text-align:center"><span class="chip-s ok">Approved</span><h3 style="margin:10px 0">${cap(act.type)} pass</h3><div id="pq" style="display:inline-block;padding:10px;background:#fff;border-radius:12px"></div><p class="num" style="margin:8px 0 2px"><b>PASS-${act.code}</b></p><p class="muted small">Show this QR to the driver when boarding</p><b>Valid until ${dt(act.to)}</b><p class="hint" style="justify-content:center">${icon('shield')}Works offline</p></section>`
      : pen ? `<section class="card"><span class="chip-s warn">Pending approval</span><p class="muted" style="margin-top:8px">Your ${pen.type} pass request is waiting for Operations.</p></section>`
      : `<section class="card"><h3 style="margin-bottom:10px">Apply for a pass</h3><div class="seg">${[['weekly', 'Weekly pass'], ['monthly', 'Monthly pass']].map(([k, l]) => `<button data-t="${k}" aria-pressed="${k === pt}">${l}</button>`).join('')}</div>
        <div class="field" style="margin-top:12px"><span>Payment receipt (optional)</span><label class="btn ghost block">${icon('upload')}${receipt ? 'Replace receipt photo' : 'Upload receipt photo'}<input type="file" accept="image/*" id="passReceiptNew" hidden></label></div>
        ${receipt ? `<img class="pdrv-photo" src="${receipt}" alt="Uploaded payment receipt"><button class="linkbtn subtle" data-remove-new-receipt>Remove receipt</button>` : '<p class="hint" style="margin-top:8px">Attach a receipt photo if you have already paid.</p>'}
        <button class="btn primary block" data-apply="1" style="margin-top:12px">Apply</button></section>`}
      ${receiptPass ? `<section class="card"><h3 style="margin-bottom:8px">Payment receipt</h3>${receiptPass.receipt ? `<img class="pdrv-photo" src="${receiptPass.receipt}" alt="Payment receipt uploaded for ${cap(receiptPass.type)} pass">` : '<p class="muted small">No receipt uploaded yet.</p>'}<label class="btn ghost block" style="margin-top:10px">${icon('upload')}${receiptPass.receipt ? 'Replace receipt photo' : 'Upload receipt photo'}<input type="file" accept="image/*" id="passReceiptCurrent" hidden></label></section>` : ''}
      <section class="card"><h3 style="margin-bottom:8px">Fare rules</h3><ul class="plist"><li>${icon('ticket')}<span>Weekly pass RM ${P.fare.weekly}, valid 7 days from approval</span></li><li>${icon('ticket')}<span>Monthly pass RM ${P.fare.monthly}, valid 30 days from approval</span></li><li>${icon('shield')}<span>Eligible students get ${P.fare.disc}% off single rides. Passes cannot be shared.</span></li></ul></section></div>`;
    const q = $('#pq', el); act && renderQR(q, 'PASS-' + act.code);
    const newFile = $('#passReceiptNew', el); if (newFile) newFile.onchange = async () => { const f = newFile.files && newFile.files[0]; if (!f) return; try { receipt = await readPhoto(f); paint(); } catch (e) { toast('Receipt not uploaded', e.message || 'Try another image.', 'danger'); } };
    const currentFile = $('#passReceiptCurrent', el); if (currentFile && receiptPass) currentFile.onchange = async () => { const f = currentFile.files && currentFile.files[0]; if (!f) return; try { receiptPass.receipt = await readPhoto(f); save(); toast('Receipt uploaded', 'Operations can review the receipt in the pass desk.', 'ok'); paint(); } catch (e) { toast('Receipt not uploaded', e.message || 'Try another image.', 'danger'); } };
  };
  paint();
  el.onclick = e => { const t = e.target.closest('button'); if (!t) return; if (t.dataset.t) { pt = t.dataset.t; paint(); } if (t.dataset.removeNewReceipt !== undefined) { receipt = null; paint(); } if (t.dataset.apply) { const id = uid('P'); P.passes.unshift({ id, code: codeFrom('PASS' + id), uid: App.s.id, type: pt, st: 'pending', at: N(), receipt }); save(); receipt = null; toast('Application sent', 'Operations will review your request and any uploaded receipt.', 'ok'); paint(); } };
  return {};
};
SCREENS.help = el => {
  let c = CATS[0], txt = '', photo = null;
  const paint = () => {
    const mine = P.issues.filter(i => i.uid === App.s.id);
    el.innerHTML = header('Help', 'Report an issue and lost & found', bellBtn()) + `<div class="content narrow stack-l"><section class="card"><h3 style="margin-bottom:10px">Report an issue</h3><div class="chips scroll">${CATS.map(x => `<button class="chip" data-c="${x}" aria-pressed="${x === c}">${x}</button>`).join('')}</div><label class="field" style="margin-top:10px"><span>Details</span><textarea class="input" id="ht" rows="3" placeholder="What happened? Add the vehicle or stop name.">${esc(txt)}</textarea></label>
      <div class="field" style="margin-top:10px"><span>Photo (optional)</span><label class="btn ghost block">${icon('camera')}${photo ? 'Replace photo' : 'Upload picture'}<input type="file" accept="image/*" id="helpPhoto" capture="environment" hidden></label></div>
      ${photo ? `<img class="pdrv-photo" src="${photo}" alt="Issue attachment"><button class="linkbtn subtle" data-remove-photo>Remove photo</button>` : ''}
      <button class="btn primary block" data-send="1" style="margin-top:10px">Submit</button></section>
      <section class="card"><h3 style="margin-bottom:8px">My reports</h3>${mine.length ? mine.map(i => `<div class="lrow static"><span class="grow"><b>${esc(i.cat)}</b><small>${esc(i.text)}</small>${i.photo ? `<button class="linkbtn" style="margin-top:4px" data-view-photo="${i.id}">View attached photo</button>` : ''}</span><span class="chip-s ${i.st === 'resolved' ? 'ok' : i.st === 'new' ? 'warn' : ''}">${i.st === 'prog' ? 'In progress' : cap(i.st)}</span></div>`).join('') : '<p class="muted">Nothing reported yet.</p>'}</section></div>`;
    const ph = $('#helpPhoto', el); if (ph) ph.onchange = async () => { const f = ph.files && ph.files[0]; if (!f) return; const desc = $('#ht', el); if (desc) txt = desc.value; try { photo = await readPhoto(f, 720); paint(); } catch (e) { toast('Photo not uploaded', e.message || 'Try another image.', 'danger'); } };
  };
  paint();
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.viewPhoto) { const i = P.issues.find(x => x.id === b.dataset.viewPhoto); if (i && i.photo) openDialog({ title: 'Issue photo', html: `<img src="${i.photo}" alt="Attached issue photo" style="display:block;max-width:100%;max-height:70vh;object-fit:contain;margin:auto">` }); return; }
    const t = $('#ht', el); t && (txt = t.value);
    if (b.dataset.c) { c = b.dataset.c; paint(); }
    if (b.dataset.removePhoto !== undefined) { photo = null; paint(); }
    if (b.dataset.send) { if (!txt.trim()) { toast('Add a few details first'); return; } P.issues.unshift({ id: uid('ISS'), uid: App.s.id, cat: c, text: txt.trim(), photo, st: 'new', who: '', at: N() }); save(); txt = ''; photo = null; toast('Report sent', 'Operations will look into it.', 'ok'); paint(); }
  };
  return {};
};
SCREENS.desk = el => {
  const nm = id => (Store.d.users[id] && Store.d.users[id].name) || id;
  const paint = () => {
    el.innerHTML = header('Desk', 'Passes, issues and lost & found', bellBtn()) + `<div class="content narrow stack-l"><section class="card"><h3 style="margin-bottom:10px">Student travel pass</h3><div class="row">${[['weekly', 'Weekly RM'], ['monthly', 'Monthly RM'], ['disc', 'Discount %']].map(([k, l]) => `<label class="field grow"><span>${l}</span><input class="input" type="number" data-f="${k}" value="${P.fare[k]}"></label>`).join('')}</div>
      ${P.passes.length ? `<div class="list card-list" style="margin-top:10px">${P.passes.slice(0, 12).map(p => `<div class="lrow static"><span class="grow"><b>${esc(nm(p.uid))}</b><small>${cap(p.type)}, ${p.st}${p.st === 'approved' ? ', expires ' + dt(p.to) : ''}</small></span>${p.receipt ? `<button class="btn sm" data-view-pass-receipt="${p.id}">View receipt</button>` : ''}${p.st === 'pending' ? `<button class="btn sm primary" data-pa="ok" data-id="${p.id}">Approve</button><button class="btn sm" data-pa="no" data-id="${p.id}">Reject</button>` : p.st === 'approved' ? `<button class="btn sm" data-pa="ext" data-id="${p.id}">+7 days</button><button class="btn sm" data-pa="rev" data-id="${p.id}">Revoke</button>` : ''}</div>`).join('')}</div>` : '<p class="muted" style="margin-top:8px">No pass requests yet.</p>'}</section>
      <section class="card"><h3 style="margin-bottom:8px">Issues and lost & found</h3>${P.issues.length ? P.issues.slice(0, 15).map(i => `<div class="lrow static" style="flex-wrap:wrap;gap:6px"><span class="grow"><b>${esc(i.cat)}</b> <span class="chip-s ${i.st === 'resolved' ? 'ok' : i.st === 'new' ? 'warn' : ''}">${i.st === 'prog' ? 'In progress' : cap(i.st)}</span><small>${esc(i.text)} (${esc(nm(i.uid))})</small>${i.photo ? `<button class="linkbtn" data-view-issue-photo="${i.id}">View photo</button>` : ''}</span><select class="input" data-ic="${i.id}">${CATS.map(x => `<option ${x === i.cat ? 'selected' : ''}>${x}</option>`).join('')}</select><select class="input" data-ia="${i.id}">${TEAMS.map(x => `<option value="${x}" ${x === i.who ? 'selected' : ''}>${x || 'Unassigned'}</option>`).join('')}</select><button class="btn sm" data-is="prog" data-id="${i.id}">In progress</button><button class="btn sm primary" data-is="resolved" data-id="${i.id}">Resolve</button></div>`).join('') : '<p class="muted">No reports yet.</p>'}</section></div>`;
  };
  paint();
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.viewPassReceipt) { const p = P.passes.find(x => x.id === b.dataset.viewPassReceipt); if (p && p.receipt) openDialog({ title: `${cap(p.type)} pass receipt`, html: `<img src="${p.receipt}" alt="Uploaded pass payment receipt" style="display:block;max-width:100%;max-height:70vh;object-fit:contain;margin:auto">` }); return; }
    if (b.dataset.viewIssuePhoto) { const i = P.issues.find(x => x.id === b.dataset.viewIssuePhoto); if (i && i.photo) openDialog({ title: 'Issue photo', html: `<img src="${i.photo}" alt="Uploaded issue photo" style="display:block;max-width:100%;max-height:70vh;object-fit:contain;margin:auto">` }); return; }
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
function setLang(l) { if (!['en', 'ms', 'bn'].includes(l)) l = 'en'; P.lang = l; save(); texts(document.body).forEach(n => { if (O.has(n)) { n.nodeValue = O.get(n); O.delete(n); } }); document.documentElement.lang = l === 'en' ? 'en' : l; texts(document.body).forEach(t1); syncLoginLang(); }
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
function feed(t) { FEED.unshift(t); FEED.length = Math.min(FEED.length, 8); if (App.s && App.s.role === 'admin') toast(t, '', '', 2400); }
let st = null;
function sim(on) {
  if (on && !P.demo) { toast('Enable Demo mode first', 'Demo simulation is managed from Admin → Account.'); return; }
  P.sim = on ? 1 : 0; save(); clearInterval(st); st = null;
  if (on) { st = setInterval(simTick, 3500); simTick(); }
}
function simTick() {
  const vs = Store.d.vehicles.filter(v => { const s = vState(v); return s && s.visible; });
  const v = vs.length ? rp(vs) : Store.d.vehicles[0];
  if (!v) return;
  const x = Math.random();
  if (x < .28) feed(`Demo scenario: passenger-flow summary for ${v.id} (admin preview only)`);
  else if (x < .52) feed(`Demo scenario: route-delay review for ${v.id} (no live incident created)`);
  else if (x < .74) feed(`Demo scenario: ${rp(CATS)} report ready for Operations review (sample only)`);
  else if (x < .9) feed(`Demo scenario: student pass application ready for review (sample only)`);
  else feed(`Demo scenario: vehicle health review for ${v.id} (sample only)`);
  // Deliberately do not create sample passenger, student, pass, issue or incident records.
  if (App.tab === 'account' && App.s && App.s.role === 'admin' && !App.busy()) App.refresh();
}

/* ---------- Sign-in language picker + Admin Account demo controls ---------- */
let loginLangObserver = null;
function syncLoginLang() {
  const login = $('.login'); let control = $('.plus-login-lang');
  if (!login) { control && control.remove(); return; }
  if (!control) {
    control = document.createElement('div'); control.className = 'plus-login-lang'; control.setAttribute('aria-label', 'Language');
    control.innerHTML = `<select data-signin-lang aria-label="Language">${[['en','English'],['ms','Bahasa Malaysia'],['bn','বাংলা']].map(([k,l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
    control.addEventListener('change', e => { const q = e.target.closest('[data-signin-lang]'); if (q) setLang(q.value); });
    document.body.appendChild(control);
  }
  const sel = $('[data-signin-lang]', control); if (sel) sel.value = P.lang;
}
function setDemoSetting(key) {
  if (!App.s || App.s.role !== 'admin') return;
  if (key === 'mode') {
    P.demo = !P.demo;
    if (!P.demo) {
      sim(false); P.off = 0; FEED.length = 0; P.delta = {};
      Object.keys(P.det || {}).forEach(id => { if (P.det[id] && P.det[id].demo) delete P.det[id]; });
      Store.set(d => {
        d.settings.ignoreHours = false; d.settings.ignoreDays = false;
        const ids = new Set(d.incidents.filter(i => i.demo).map(i => i.vehicle));
        d.incidents = d.incidents.filter(i => !i.demo);
        d.vehicles.forEach(v => { if (ids.has(v.id) && v.hold) clearHold(v); });
        d.log = d.log.filter(x => !/^\[Demo\]/.test(x.text || ''));
      });
      offUI(); save();
    }
    save(); return;
  }
  if (!P.demo) return;
  if (key === 'sim') { sim(!P.sim); save(); return; }
  if (key === 'ignoreHours' || key === 'ignoreDays') { Store.set(d => { d.settings[key] = !d.settings[key]; }); save(); return; }
  if (key === 'offline') { P.off = P.off ? 0 : 1; save(); if (!P.off && navigator.onLine) online(); else offUI(); }
}
window.KLUSTSetLanguage = setLang;
window.KLUSTGetLanguage = () => P.lang;
window.KLUSTDemoState = () => ({ demo: !!P.demo, sim: !!P.sim, off: !!P.off, ignoreHours: !!Store.d.settings.ignoreHours, ignoreDays: !!Store.d.settings.ignoreDays, feed: App.s && App.s.role === 'admin' ? FEED.slice(0, 5) : [] });
window.KLUSTSetDemoSetting = setDemoSetting;
loginLangObserver = new MutationObserver(() => syncLoginLang());
loginLangObserver.observe($('#app') || document.body, { childList: true, subtree: true });
requestAnimationFrame(syncLoginLang);
addEventListener('storage', e => { if (e.key === PK) { try { Object.assign(P, JSON.parse(e.newValue)); } catch (x) { } if ((['pass', 'help', 'desk'].includes(App.tab) || (App.tab === 'account' && App.s && App.s.role === 'admin')) && !App.busy()) App.refresh(); } });
setInterval(() => {
  if (!offline()) P.sync = N();
  offUI();
  syncLoginLang();
}, 1000);
// Migrate away from the old demo behavior, which could make sample incidents/passenger deltas look live.
if (Store.d && Store.d.incidents && Store.d.incidents.some(i => i.demo)) {
  Store.set(d => {
    const ids = new Set(d.incidents.filter(i => i.demo).map(i => i.vehicle));
    d.incidents = d.incidents.filter(i => !i.demo);
    d.vehicles.forEach(v => { if (ids.has(v.id) && v.hold) clearHold(v); });
    d.log = d.log.filter(x => !/^\[Demo\]/.test(x.text || ''));
  });
}
if (!P.demo && Store.d.settings && (Store.d.settings.ignoreHours || Store.d.settings.ignoreDays)) {
  Store.set(d => { d.settings.ignoreHours = false; d.settings.ignoreDays = false; });
}
if (P.sim && P.demo) sim(true); else { P.sim = 0; save(); }
if (App.s) App.render(false);
if (P.lang !== 'en') setLang(P.lang);
})();
