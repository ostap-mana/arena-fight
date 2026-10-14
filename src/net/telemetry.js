/* GroudNext Telemetry SDK — сесії й забіги test-build гри → аналітика (POST /api/ingest, docs/ARCHITECTURE.md §2).

   ЛИШЕ для окремого test-build. Ad-ship білд для рекламних мереж мусить мати 0 зовнішніх запитів —
   цей файл туди не підключається взагалі (прапорець збирача, docs/INTEGRATION.md).

   Принципи:
   - не блокує гру: робота — після кадру (requestIdleCallback / setTimeout), стиснення — потоком, усі
     помилки ковтаються (аналітика ніколи не ламає гру);
   - без PII: anon id — випадковий UUID у localStorage; IP сервер не зберігає;
   - ідемпотентно: id сесії й забігу, seq подій — повтор відправки не дублює дані;
   - не губить: невдала відправка → outbox у localStorage → повтор з паузою і на наступному запуску;
     закриття сторінки посеред забігу → «quit» з частковою плівкою (сервер замінить її фіналом,
     якщо гравець повернеться й дограє).

   Використання (див. docs/INTEGRATION.md):
     const tm = initTelemetry({ endpoint, variant, build, levelHash, level });
     tm.gameReady(); tm.firstInput(); tm.runStart(); tm.runEnd({ result, tape, trace, stats, tier });
     tm.retryClicked(); tm.ctaClicked(); tm.setPartialProvider(() => ({ tape, trace, stats, tier })); */

export const SDK_VERSION = '0.3.0';

const KEEPALIVE_MAX = 60000;        // keepalive / sendBeacon: браузер тримає ≈ 64 КБ на все, що в польоті
const MAX_BODY = 1400000;           // сервер приймає ≤ 1.5 МБ стисненого тіла
const MAX_TAPE_RAW = 1200000;       // ≈ 270 КБ у gzip — під серверні 300 КБ на плівку
const MAX_EVENTS = 150;             // подій в одному конверті (сервер — ≤ 200)
const ANON_KEY = 'groud.tm.anon', OUTBOX_KEY = 'groud.tm.outbox';
const OUTBOX_MAX_CHARS = 1500000, OUTBOX_MAX_ITEMS = 20, OUTBOX_TTL = 3 * 864e5;
const RETRY_MS = [2000, 10000, 30000];
const LABEL = /^[A-Za-z0-9_.-]{1,40}$/, VARIANT = /^[A-Za-z0-9_.-]{1,32}$/, HASH = /^[0-9a-f]{8}$/;
const RESULT = { win: 'win', victory: 'win', lose: 'lose', death: 'lose', quit: 'quit' };

const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;
const txt = (v, n = 120) => (typeof v === 'string' && v ? v.slice(0, n) : null);
const numOr = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const mb = (v) => (typeof v === 'number' && v > 0 ? r1(v / 1048576) : null);
const pick = (re, v) => (typeof v === 'string' && re.test(v) ? v : null);

function uuid(w) {
  const c = w.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256;
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// localStorage може кидати (приватний режим, заблоковані cookies) — тоді живемо без нього.
function storageOf(s) {
  return {
    get(k) { try { return s ? s.getItem(k) : null; } catch { return null; } },
    set(k, v) { try { if (s) s.setItem(k, v); return !!s; } catch { return false; } },
    del(k) { try { if (s) s.removeItem(k); } catch { /* нема доступу */ } },
  };
}

// gzip через CompressionStream (Chrome 80+, Safari 16.4+, Firefox 113+); нема — шлемо як є (сервер приймає обидва).
async function gzip(w, text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof w.CompressionStream !== 'function') return bytes;
  try {
    const stream = new w.Blob([bytes]).stream().pipeThrough(new w.CompressionStream('gzip'));
    return new Uint8Array(await new w.Response(stream).arrayBuffer());
  } catch { return bytes; }
}

// Плівка задовга → проріджуємо знімки вдвічі (10 → 5 → 2.5 Гц, replay інтерполює), далі — без плівки.
export function fitTape(tape, maxRaw = MAX_TAPE_RAW) {
  let t = tape, json = JSON.stringify(t);
  for (let i = 0; i < 2 && json.length > maxRaw && t?.samples?.length > 2; i++) {
    const n = t.samples.length;
    t = { ...t, sampleS: (t.sampleS || 0.1) * 2, samples: t.samples.filter((_, k) => k % 2 === 0 || k === n - 1) };
    json = JSON.stringify(t);
  }
  return json.length > maxRaw ? null : t;
}

export function initTelemetry(o = {}) {
  const w = o.win || globalThis;
  const nav = w.navigator || {}, doc = w.document, loc = w.location || {};
  const now = o.now || (() => Date.now());
  const perf = o.perf || (() => (w.performance?.now ? w.performance.now() : now()));
  const later = o.setTimeout || ((f, ms) => setTimeout(f, ms));
  const cancel = o.clearTimeout || ((h) => clearTimeout(h));
  const idle = (f) => (w.requestIdleCallback ? w.requestIdleCallback(f, { timeout: 1000 }) : later(f, 0));
  const doFetch = o.fetch || (w.fetch ? w.fetch.bind(w) : null);
  const beacon = o.sendBeacon || (nav.sendBeacon ? nav.sendBeacon.bind(nav) : null);
  const store = storageOf(o.storage !== undefined ? o.storage : (() => { try { return w.localStorage; } catch { return null; } })());
  const log = o.debug ? (...a) => console.log('[telemetry]', ...a) : () => {};
  const endpoint = o.endpoint;

  const noop = () => {};
  const off = { sessionId: null, whenIdle: async () => {}, setPerfContext: noop, setRendererInfo: noop, setGl: noop, gameReady: noop, firstInput: noop, runStart: () => 0, runEnd: noop, retryClicked: noop, ctaClicked: noop, event: noop, setPartialProvider: noop, flush: async () => {}, dispose: noop };
  if (!endpoint || !doFetch) return off;

  const q = (() => { try { return new URLSearchParams(loc.search || ''); } catch { return new URLSearchParams(); } })();
  let anon = store.get(ANON_KEY);
  if (!anon || !/^[0-9a-f-]{36}$/i.test(anon)) { anon = uuid(w); store.set(ANON_KEY, anon); }
  const scr = w.screen, dpr = Number(w.devicePixelRatio) || 1;
  const ref = (() => { try { return doc?.referrer ? new URL(doc.referrer).host.slice(0, 100) || null : null; } catch { return null; } })();
  const session = {
    id: uuid(w), anon_id: anon,
    variant: pick(VARIANT, o.variant ?? q.get('v')) || 'default',
    build: pick(LABEL, o.build), project: pick(/^[a-z0-9-]{1,32}$/, o.project) || undefined, level_hash: pick(HASH, o.levelHash), src: pick(LABEL, o.src ?? q.get('src')),
    started_at: now(), ua: String(nav.userAgent || '').slice(0, 512),
    screen: scr?.width >= 1 && scr?.height >= 1 ? { w: Math.min(20000, Math.round(scr.width)), h: Math.min(20000, Math.round(scr.height)), dpr: Math.min(10, Math.max(0.25, dpr)) } : null,
    lang: pick(/^[A-Za-z0-9_-]{1,35}$/, nav.language), touch: 'ontouchstart' in w || nav.maxTouchPoints > 0,
    ref: pick(/^[A-Za-z0-9.-]{1,100}(:\d{1,5})?$/, ref), webdriver: nav.webdriver === true,
  };
  const t0 = perf();
  let seq = 0, attempt = 0, run = null, partial = null, events = [], level = Array.isArray(o.level) && session.level_hash ? { hash: session.level_hash, markers: o.level } : null;
  let flushTimer = null, firstInputDone = false, errors = 0, disposed = false, retryIdx = 0, draining = false;
  const inflight = new Set();
  const track = (p) => { inflight.add(p); p.finally(() => inflight.delete(p)).catch(() => {}); return p; };

  const envelope = (extra = {}) => ({ v: 1, sdk: SDK_VERSION, sent_at: now(), session, ...extra });

  /* ── ПРОДУКТИВНІСТЬ (docs/INTEGRATION.md § Профайл) ──
     Кадри — власний rAF, лише поки йде забіг і сторінка видима (і не між run.adHidden / run.adShown).
     Мітки гри — стандартні performance.mark / measure: boot.* (фази завантаження), run.* (контекст спайків).
     Пристрій — UA-CH, пам'ять, ядра, мережа, GPU (setGl). Усе під try: профайл не має ламати гру. */
  const P = w.performance, raf = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : null;
  const conn = nav.connection || {}, uad = nav.userAgentData;
  const device = {
    model: null, platform: txt(uad?.platform, 40), platform_version: null, mobile: typeof uad?.mobile === 'boolean' ? uad.mobile : null,
    gpu_vendor: null, gpu: null, mem: numOr(nav.deviceMemory), cores: numOr(nav.hardwareConcurrency),
    net: txt(conn.effectiveType, 10), save_data: typeof conn.saveData === 'boolean' ? conn.saveData : null,
  };
  const boot = { phases: {}, nav: null, first_frame: null, ready: null, first_input: null };
  session.device = device;
  session.boot = boot;
  try { uad?.getHighEntropyValues?.(['model', 'platformVersion']).then((v) => { device.model = txt(v.model, 60); device.platform_version = txt(v.platformVersion, 20); }, () => {}); } catch { /* нема UA-CH */ }

  function collectBoot() {
    try {
      for (const m of P.getEntriesByType('measure')) {
        if (m.name.startsWith('boot.') && Object.keys(boot.phases).length < 40) boot.phases[m.name.slice(0, 40)] = [Math.round(m.startTime), Math.round(m.duration)];
      }
      const n = P.getEntriesByType('navigation')[0];
      if (n) boot.nav = { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), bytes: numOr(n.transferSize) };
    } catch { /* старий браузер — без фаз */ }
  }

  let pr = null, ctx = null, info = null, last = 0, adHidden = false, rafOn = false;
  const fine = new Uint32Array(251);   // 1-мс кошики 0..250 мс — для p50/p95/p99
  const recent = [];                   // останні run.* мітки: [startTime, name]
  const runT = () => { let c = null; try { c = ctx ? ctx() : null; } catch { c = null; } return numOr(c?.t) ?? (perf() - pr.t0) / 1000; };
  const detailOf = (e) => { try { const d = e.detail; if (d == null) return null; const j = JSON.stringify(d); return j.length <= 80 ? d : null; } catch { return null; } };

  function observe(type, cb) {
    try {
      const PO = w.PerformanceObserver;
      if (!PO || !(PO.supportedEntryTypes || []).includes(type)) return;
      new PO((list) => { for (const e of list.getEntries()) { try { cb(e); } catch { /* одна мітка не зупиняє решту */ } } }).observe({ type, buffered: true });
    } catch { /* нема PerformanceObserver */ }
  }
  observe('mark', (e) => {
    const n = e.name;
    if (n === 'boot.firstFrame') boot.first_frame = Math.round(e.startTime);
    if (!n.startsWith('run.')) return;
    recent.push([e.startTime, n.slice(0, 40)]);
    if (recent.length > 40) recent.shift();
    if (n === 'run.adHidden') adHidden = true;
    else if (n === 'run.adShown') adHidden = false;
    if (!pr) return;
    const t = r1(runT()), d = detailOf(e);
    if (pr.marks.length < 300) pr.marks.push(d ? [t, n.slice(0, 40), d] : [t, n.slice(0, 40)]);
    if (n === 'run.quality' && pr.quality.length < 100) pr.quality.push([t, d?.step ?? null, txt(String(d?.reason ?? ''), 40)]);
  });
  observe('longtask', (e) => {
    if (!pr) return;
    pr.lt.n++; pr.lt.ms += e.duration;
    pr.lt.top.push([r1(runT()), Math.round(e.duration)]);
    pr.lt.top.sort((a, b) => b[1] - a[1]);
    if (pr.lt.top.length > 10) pr.lt.top.pop();
  });

  function perfStart() {
    pr = { t0: perf(), frames: 0, sum: 0, max: 0, hist: [0, 0, 0, 0, 0], series: [], sec: -1, sAcc: 0, sN: 0, sMax: 0,
      spikes: [], spikes_n: 0, spikes_ms: 0, lt: { n: 0, ms: 0, top: [] }, quality: [], info: [], marks: [], nextInfo: 0, mem: [], memMax: 0, memLim: 0, nextMem: 0 };
    fine.fill(0);
    last = 0;
    if (raf && !rafOn) { rafOn = true; raf(tick); }
  }
  function tick(ts) {
    if (!pr || disposed) { rafOn = false; return; }
    const at = typeof ts === 'number' ? ts : perf(), dt = last ? at - last : 0;
    last = at;
    if (dt > 0 && dt < 1000 && !adHidden && doc?.visibilityState !== 'hidden') { try { frame(dt, at); } catch { /* профайл — не гра */ } }
    raf(tick);
  }
  const pushSec = (p, out) => { if (p.sN && out.length < 1200) out.push([p.sec, r1(p.sAcc / p.sN), Math.round(p.sMax)]); };
  function frame(dt, at) {
    const p = pr, t = runT(), sec = Math.floor(t);
    p.frames++; p.sum += dt; if (dt > p.max) p.max = dt;
    p.hist[dt < 16.7 ? 0 : dt < 33.4 ? 1 : dt < 50 ? 2 : dt < 100 ? 3 : 4]++;
    fine[Math.min(250, Math.round(dt))]++;
    if (sec !== p.sec) { pushSec(p, p.series); p.sec = sec; p.sAcc = 0; p.sN = 0; p.sMax = 0; }
    p.sAcc += dt; p.sN++; if (dt > p.sMax) p.sMax = dt;
    if (dt > 50) {
      p.spikes_n++; p.spikes_ms += dt;
      const ev = [...new Set(recent.filter((m) => m[0] >= at - dt - 30).map((m) => m[1]))].slice(0, 6);
      p.spikes.push(ev.length ? { t: r1(t), ms: Math.round(dt), ev } : { t: r1(t), ms: Math.round(dt) });
      p.spikes.sort((a, b) => b.ms - a.ms);
      if (p.spikes.length > 40) p.spikes.pop();
    }
    if (info && at >= p.nextInfo) {
      p.nextInfo = at + 5000;
      const i = info();
      if (i && p.info.length < 400) p.info.push([r1(t), i.render?.calls ?? 0, i.render?.triangles ?? 0, i.programs?.length ?? 0, i.memory?.textures ?? 0, i.memory?.geometries ?? 0]);
    }
    // купа JS (performance.memory — лише Chrome) раз на 5 с: [[t, used МБ, total МБ]]
    if (at >= p.nextMem) {
      p.nextMem = at + 5000;
      const m = P?.memory, u = mb(m?.usedJSHeapSize);
      if (u != null && p.mem.length < 400) { p.mem.push([r1(t), u, mb(m.totalJSHeapSize) ?? u]); if (u > p.memMax) p.memMax = u; p.memLim = mb(m.jsHeapSizeLimit) ?? 0; }
    }
  }
  function pct(q, n) { let k = 0; for (let i = 0; i < 251; i++) { k += fine[i]; if (k >= q * n) return i; } return 250; }
  function profile() {
    const p = pr;
    if (!p || !p.frames) return null;
    const series = p.series.slice();
    pushSec(p, series);   // поточна секунда — без зміни стану (частковий знімок не задвоїть її потім)
    return { v: 1, frames: p.frames, avg_fps: r1(1000 / (p.sum / p.frames)), p50: pct(0.5, p.frames), p95: pct(0.95, p.frames), p99: pct(0.99, p.frames),
      max: Math.round(p.max), hist: p.hist.slice(), series, spikes: p.spikes.slice(), spikes_n: p.spikes_n, spikes_ms: Math.round(p.spikes_ms),
      lt: { n: p.lt.n, ms: Math.round(p.lt.ms), top: p.lt.top.slice() }, quality: p.quality.slice(), info: p.info.slice(), marks: p.marks.slice(),
      ...(p.mem.length ? { mem: p.mem.slice(), mem_max: p.memMax, ...(p.memLim ? { mem_limit: p.memLim } : {}) } : {}) };
  }

  function event(type, data, att = run ? run.attempt : attempt || null) {
    if (disposed || !/^[a-z][a-z0-9_]{0,31}$/.test(type)) return;
    let d = data && typeof data === 'object' ? data : null;
    if (d) { try { if (JSON.stringify(d).length > 2000) d = null; } catch { d = null; } }
    events.push({ seq: seq++, t: Math.max(0, r3((perf() - t0) / 1000)), type, attempt: att || null, data: d });
    if (events.length >= MAX_EVENTS) track(flush()); else schedule();
  }

  function schedule(ms = 2000) {
    if (flushTimer) return;
    flushTimer = later(() => { flushTimer = null; track(flush()); }, ms);
  }

  const takeEvents = () => events.splice(0, MAX_EVENTS);

  // ── outbox: те, що не дійшло (сирий JSON конверта; стискаємо перед відправкою) ──
  const readBox = () => { try { const a = JSON.parse(store.get(OUTBOX_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  function writeBox(items) {
    const fresh = items.filter((x) => x && typeof x.body === 'string' && now() - x.at < OUTBOX_TTL).slice(-OUTBOX_MAX_ITEMS);
    while (fresh.length && fresh.reduce((n, x) => n + x.body.length, 0) > OUTBOX_MAX_CHARS) fresh.shift();   // найстаріші — геть
    if (fresh.length) store.set(OUTBOX_KEY, JSON.stringify(fresh)); else store.del(OUTBOX_KEY);
  }
  const boxPut = (key, body) => writeBox([...readBox().filter((x) => x.key !== key), { key, body, at: now() }]);
  const boxDel = (key) => writeBox(readBox().filter((x) => x.key !== key));

  // → true: доставлено або безнадійно (4xx — повтор не допоможе); false: варто повторити.
  async function post(body, { keepalive = false } = {}) {
    try {
      let bytes = await gzip(w, body);
      if (bytes.length > MAX_BODY) return true;   // сервер однаково не прийме — не тримаємо в outbox
      const r = await doFetch(endpoint, {
        method: 'POST', body: bytes, headers: { 'content-type': 'text/plain' },   // safelisted → без CORS-preflight
        keepalive: keepalive && bytes.length <= KEEPALIVE_MAX, mode: 'cors', credentials: 'omit',
      });
      log('POST', r.status, bytes.length);
      return r.ok || (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429);
    } catch (e) { log('POST failed', e?.message); return false; }
  }

  // Відправка з гарантією: спершу в outbox (переживе закриття), після успіху — геть.
  function send(key, env, opts) {
    const body = JSON.stringify(env);
    boxPut(key, body);
    return track((async () => {
      if (await post(body, opts)) { boxDel(key); retryIdx = 0; return true; }
      retryLater();
      return false;
    })());
  }

  function retryLater() {
    if (retryIdx >= RETRY_MS.length) return;   // далі — на наступному запуску сторінки
    later(() => track(drain()), RETRY_MS[retryIdx++]);
  }

  async function drain() {
    if (draining || disposed) return;
    draining = true;
    try {
      for (const item of readBox()) {
        if (!(await post(item.body))) { retryLater(); break; }
        boxDel(item.key);
      }
    } finally { draining = false; }
  }

  async function flush() {
    if (flushTimer) { cancel(flushTimer); flushTimer = null; }
    if (!events.length) return true;
    const evs = takeEvents();
    const ok = await send(`ev:${session.id}:${evs[0].seq}`, envelope({ events: evs, ...(level ? { level } : {}) }));
    level = null;   // рівень — раз на сесію (сервер: ON CONFLICT DO NOTHING); не дійшов — він у тілі в outbox
    if (events.length) schedule(0);
    return ok;
  }

  // Забіг → запис для конверта; плівка й журнал — як дає гра (dev-recorder.js / журнал dev.js).
  function runRecord(r, { result, tape, trace, stats, tier, duration, perf: prof }) {
    const fitted = tape ? fitTape(tape) : null;
    const dur = Number.isFinite(duration) ? duration
      : Number.isFinite(tape?.t) && tape.t > 0 ? tape.t
      : Number.isFinite(trace?.tEnd) && trace.tEnd > 0 ? trace.tEnd : (perf() - r.startPerf - r.hiddenMs - (r.hiddenAt ? perf() - r.hiddenAt : 0)) / 1000;   // без часу схованої вкладки
    return {
      id: r.id, attempt: r.attempt, result, started_at: r.started_at, duration: Math.min(3600, Math.max(0, r3(dur))),
      level_hash: session.level_hash, autoplay: !!trace?.autoplay,
      stats: stats && typeof stats === 'object' ? stats : null, tier: Number.isInteger(tier) ? tier : null,
      tape: fitted, trace: trace || null, tape_dropped: tape && !fitted ? 'too_big' : null, perf: prof || null,
    };
  }

  // Частковий стан поточного забігу (на hidden / pagehide) — результат quit.
  function partialRecord() {
    if (!run) return null;
    let p = null;
    try { p = partial ? partial() : null; } catch { p = null; }
    return runRecord(run, { result: 'quit', ...(p || {}), perf: profile() });
  }

  function onHidden() {
    event('hidden', null);
    const rec = partialRecord();
    const evs = takeEvents();
    if (flushTimer) { cancel(flushTimer); flushTimer = null; }
    // сторінка ще жива — стискаємо й шлемо з keepalive; якщо не встигне, конверт лишиться в outbox
    if (rec || evs.length) send(rec ? `run:${rec.id}:q` : `ev:${session.id}:${evs[0].seq}`, envelope({ events: evs, ...(rec ? { runs: [rec] } : {}) }), { keepalive: true });
  }

  // pagehide — останній синхронний шанс: стиснути вже не встигнемо; маленьке — sendBeacon, решта лишається в outbox.
  function onPageHide() {
    const rec = run ? partialRecord() : null;
    const evs = takeEvents();
    if (!rec && !evs.length) return;
    const key = rec ? `run:${rec.id}:q` : `ev:${session.id}:${evs[0].seq}`;
    const body = JSON.stringify(envelope({ events: evs, ...(rec ? { runs: [rec] } : {}) }));
    boxPut(key, body);
    try {
      if (beacon && body.length <= KEEPALIVE_MAX && beacon(endpoint, new w.Blob([body], { type: 'text/plain' }))) boxDel(key);
    } catch { /* лишиться в outbox до наступного запуску */ }
  }

  const listeners = [];
  const on = (target, type, fn) => { if (target?.addEventListener) { target.addEventListener(type, fn); listeners.push([target, type, fn]); } };
  const guard = (fn) => (...a) => { try { return fn(...a); } catch (e) { log('error', e?.message); } };
  on(doc, 'visibilitychange', guard(() => { if (doc.visibilityState === 'hidden') { if (run && !run.hiddenAt) run.hiddenAt = perf(); onHidden(); } else { if (run?.hiddenAt) { run.hiddenMs += perf() - run.hiddenAt; run.hiddenAt = 0; } event('visible', null); } }));
  on(w, 'pagehide', guard(onPageHide));
  on(w, 'error', guard((e) => { if (errors++ < 5) event('error', { msg: String(e?.message || 'error').slice(0, 160) }); }));
  on(w, 'unhandledrejection', guard((e) => { if (errors++ < 5) event('error', { msg: String(e?.reason?.message || e?.reason || 'rejection').slice(0, 160), kind: 'promise' }); }));

  // Старт сесії: подія + «серцебиття» одразу (відмова ще до старту гри теж має бути видна) і старий outbox.
  event('session_start', { vw: Math.round(w.innerWidth || 0), vh: Math.round(w.innerHeight || 0) }, null);
  idle(guard(() => { track(flush().then((ok) => ok && drain())); }));

  const api = {
    sessionId: session.id,
    get attempt() { return attempt; },
    gameReady: guard(() => { boot.ready = Math.round(perf()); collectBoot(); event('game_ready', { ms: Math.round(perf() - t0) }, null); schedule(500); }),
    firstInput: guard(() => { if (firstInputDone) return; firstInputDone = true; boot.first_input = Math.round(perf()); collectBoot(); event('first_input', null); }),
    runStart: guard(() => {
      if (run) runEndImpl({ result: 'quit' });   // гра почала новий, не закривши старий
      attempt++;
      run = { id: uuid(w), attempt, started_at: now(), startPerf: perf(), hiddenMs: 0, hiddenAt: doc?.visibilityState === 'hidden' ? perf() : 0 };
      perfStart();
      event('run_start', null, attempt);
      return attempt;
    }),
    runEnd: guard((d) => runEndImpl(d || {})),
    retryClicked: guard(() => { event('retry_click', null, attempt || null); }),
    // CTA часто веде зі сторінки (стор) — шлемо одразу маленьким beacon'ом
    ctaClicked: guard(() => { event('cta_click', null); onPageHide(); }),
    event: guard((type, data) => event(type, data)),
    setPartialProvider: guard((fn) => { partial = typeof fn === 'function' ? fn : null; }),
    // профайл: годинник забігу гри ({ t } — с симуляції), renderer.info three.js, WebGL-контекст (GPU, втрата контексту)
    setPerfContext: guard((fn) => { ctx = typeof fn === 'function' ? fn : null; }),
    setRendererInfo: guard((fn) => { info = typeof fn === 'function' ? fn : null; }),
    setGl: guard((gl) => {
      if (!gl?.getParameter) return;
      const ext = gl.getExtension?.('WEBGL_debug_renderer_info');
      device.gpu_vendor = txt(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
      device.gpu = txt(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      on(gl.canvas, 'webglcontextlost', guard(() => event('gl_lost', null)));
    }),
    flush: () => track(flush()).catch(() => {}),
    // усі відправки в польоті завершились (тести; гра — перед навмисним переходом зі сторінки)
    whenIdle: async () => { while (inflight.size) await Promise.allSettled([...inflight]); },
    dispose: guard(() => { disposed = true; for (const [t, ty, fn] of listeners) t.removeEventListener(ty, fn); }),
  };

  function runEndImpl({ result, tape, trace, stats, tier, duration }) {
    if (!run) return;
    const r = run, res = RESULT[result] || 'quit', prof = profile();
    run = null;
    pr = null;   // rAF-петля профайлу зупиниться сама
    collectBoot();   // пізні фази завантаження теж потрапляють у сесію
    event('run_end', { result: res }, r.attempt);
    // важка частина (JSON плівки, gzip) — після кадру, щоб екран результату з'явився без затримки
    idle(guard(() => {
      const rec = runRecord(r, { result: res, tape, trace, stats, tier, duration, perf: prof });
      track(send(`run:${r.id}`, envelope({ events: takeEvents(), runs: [rec] })).then(() => boxDel(`run:${r.id}:q`)));
    }));
  }

  return api;
}
