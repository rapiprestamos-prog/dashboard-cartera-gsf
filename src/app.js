(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const C = window.Core;
  const LIBS = window.__LIBS__;
  const BCOL = ['#34d399', '#a3e635', '#fbbf24', '#fb923c', '#f87171', '#e11d48'];
  const PAL = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f472b6', '#fb7185', '#a78bfa', '#22d3ee', '#f59e0b', '#4ade80'];

  // ---------- formato ----------
  const nf2 = new Intl.NumberFormat('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('es-PA', { maximumFractionDigits: 0 });
  const money = v => '$' + nf2.format(v || 0);
  const money0 = v => '$' + nf0.format(v || 0);
  const short = v => { v = v || 0; const a = Math.abs(v); return (v < 0 ? '-' : '') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a.toFixed(0)); };
  const pct = (v, d = 1) => ((v || 0) * 100).toFixed(d) + '%';
  const int = v => nf0.format(v || 0);
  const dd = s => { if (!s || s < '1901') return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

  // ---------- estado ----------
  const S = { config: JSON.parse(JSON.stringify(C.DEFAULT_CONFIG)), history: {}, models: {}, current: null, tab: 'resumen', moraMig: true, store: null, uid: null, downloads: null, gs: null, gsDetalle: {}, gsStatus: '' };
  const capUse = n => (window.claude && typeof window.claude.use === 'function') ? window.claude.use(n).catch(() => null) : Promise.resolve(null);

  // ---------- carga de librerías ----------
  const loaded = {};
  function loadScript(key) {
    if (loaded[key]) return loaded[key];
    const urls = [].concat(LIBS[key]);
    const tryOne = i => new Promise((res, rej) => {
      if (i >= urls.length) return rej(new Error('No se pudo descargar la librería "' + key + '". Revisa tu conexión a internet y vuelve a intentar.'));
      const s = document.createElement('script'); s.src = urls[i]; s.async = true;
      s.onload = res; s.onerror = () => { s.remove(); tryOne(i + 1).then(res, rej); };
      document.head.appendChild(s);
    });
    loaded[key] = tryOne(0).catch(e => { delete loaded[key]; throw e; });
    return loaded[key];
  }

  // ---------- almacenamiento ----------
  const LS = { get(k) { try { return JSON.parse(localStorage.getItem('gsfdash.' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('gsfdash.' + k, JSON.stringify(v)); } catch (e) { } }, del(k) { try { localStorage.removeItem('gsfdash.' + k); } catch (e) { } } };
  // ---------- Google Sheets (Apps Script) ----------
  // Igual que "Seguimiento de tareas": usuario + contraseña, sesión con token de 30 días guardado en este navegador.
  const okUrl = u => /^https:\/\//.test(u || '') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u || '');
  const GS_FIXED = okUrl(window.__GS_URL__) ? window.__GS_URL__ : '';
  const gsCfg = () => {
    if (S.gs) return S.gs;
    const saved = LS.get('sheets') || {};
    S.gs = { url: GS_FIXED || saved.url || '', token: LS.get('tok') || '', me: LS.get('me') || null, detalle: true };
    return S.gs;
  };
  function gsRemember() { const g = gsCfg(); LS.set('sheets', { url: GS_FIXED ? undefined : g.url, detalle2: g.detalle }); if (g.token) { LS.set('tok', g.token); LS.set('me', g.me); } else { LS.del('tok'); LS.del('me'); } }
  const gsOn = () => { const g = gsCfg(); return !!(g.url && g.token); };
  const ROL_NOMBRE = { admin: 'Administración', gerencia: 'Gerencia', analista: 'Analista', consulta: 'Consulta' };
  // Qué puede hacer el usuario conectado (dentro de Claude o sin Sheets: todo)
  const puede = acc => { const g = gsCfg(); if (window.claude || !gsOn() || !g.me || !g.me.permisos) return true; return acc === 'usuarios' ? g.me.rol === 'admin' : acc === 'descargar' ? g.me.permisos.indexOf('getModel') >= 0 : g.me.permisos.indexOf(acc) >= 0; };
  function aplicarPermisos() { const tu = document.getElementById('tabUsuarios'); if (tu) { tu.style.display = !window.claude && gsOn() && puede('usuarios') ? '' : 'none'; const bd = tu.querySelector('.badge'); if (bd) bd.remove(); if (S.pendientes) tu.insertAdjacentHTML('beforeend', `<span class="badge" style="margin-left:6px;background:#f59e0b;color:#111;border-radius:99px;padding:0 7px;font-size:11px;font-weight:700">${S.pendientes}</span>`); } document.body.classList.toggle('sin-carga', !puede('saveMonth')); document.body.classList.toggle('sin-descarga', !puede('descargar')); }
  async function gsCall(body, ms) {
    const g = gsCfg();
    const r = await withTimeout(fetch(g.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({}, body, { token: g.token })) }), ms || 120000);
    const j = await r.json();
    if (!j.ok) { if (j.error === 'SESION' && g.token) { g.token = ''; gsRemember(); } throw new Error(j.error || 'Error en Google Sheets'); }
    return j.data || {};
  }
  const gsGet = p => gsCall(p, 60000), gsPost = b => gsCall(b);
  async function gzip(str) {
    if (typeof CompressionStream === 'undefined') return 'raw:' + str;
    const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return 'gz:' + btoa(bin);
  }
  async function gzipBytes(u8) {
    if (typeof CompressionStream === 'undefined') { let b = ''; for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return 'b64:' + btoa(b); }
    const cs = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = new Uint8Array(await new Response(cs).arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return 'gz:' + btoa(bin);
  }
  async function gunzipBytes(s) {
    const bin = atob(s.slice(s.startsWith('b64:') ? 4 : 3)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (s.startsWith('b64:')) return u.buffer;
    return await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  async function gunzip(s) {
    if (!s) return null; if (s.startsWith('raw:')) return s.slice(4);
    const bin = atob(s.slice(3)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip')); return await new Response(ds).text();
  }
  const LITE_R = ['recaudo', 'pagos', 'intereses', 'cancelados', 'aVencer', 'vencidos', 'segvida', 'feci'];
  function modelLite(md) { const R = {}; LITE_R.forEach(k => R[k] = md.R[k] || []); return { month: md.month, baseFrom: md.baseFrom, reportsLoaded: md.reportsLoaded, loans: md.loans, R }; }
  function clientesRows(md) {
    return md.loans.map(l => [l.id, l.nombre, l.cedula, String(l.sucursal).replace(/^\d+\s+/, ''), l.producto, l.patrono, l.oficial, l.clas, l.dias, l.monto, l.saldo, l.corriente, l.totalMoroso, l.letra, C.freqName(l.freq), l.letrasMes || 0, l.letrasSig || 0, l.pagadoMes, l.fprest || '', l.fini || '', l.fvenc || '', C.validDate(l.fult) || '', l.estado]);
  }
  async function gsSaveMonth(ag, md, reps) {
    const body = { action: 'saveMonth', agg: ag };
    if (gsCfg().detalle && md) {
      body.modelo = await gzip(JSON.stringify(modelLite(md))); body.clientes = clientesRows(md);
      const conRaw = (reps || []).filter(r => r.raw);
      if (conRaw.length) body.archivos = await Promise.all(conRaw.map(async r => ({ nombre: r.filename, data: await gzipBytes(new Uint8Array(r.raw)) })));
    }
    await gsPost(body); S.gsDetalle[ag.month] = !!body.modelo;
  }
  async function gsLoadModel(ym) {
    const j = await gsGet({ action: 'getModel', month: ym }); const txt = await gunzip(j.data); if (!txt) return null;
    const md = JSON.parse(txt); md.R = md.R || {}; return md;
  }
  async function storeInit() {
    if (gsOn()) {
      try {
        const [lst, cfg] = await Promise.all([gsGet({ action: 'list' }), gsGet({ action: 'getConfig' }).catch(() => ({}))]);
        (lst.meses || []).forEach(m => { S.history[m.month] = m.agg; S.gsDetalle[m.month] = m.detalle; });
        if (cfg && cfg.config) mergeConfig(cfg.config);
        S.gsStatus = 'ok'; return;
      } catch (e) { S.gsStatus = 'error: ' + e.message; toast('No se pudo leer Google Sheets (' + e.message + '). Se usa el historial de este navegador.', 7000); }
    }
    return storeInitBase();
  }
  async function storeInitBase() {
    const [db, user] = await Promise.all([capUse('db'), capUse('user')]);
    if (db && user) {
      try { const id = await user.id(); if (id) { S.store = db; S.uid = id; } } catch (e) { }
    }
    if (S.store) {
      try {
        const snap = await withTimeout(S.store.collection('data/users/' + S.uid).get(), 10000);
        snap.docs.forEach(d => { const v = d.data(); if (!v) return; if (d.id === 'config') mergeConfig(v); else if (d.id.startsWith('m') && v.month) S.history[v.month] = v; });
      } catch (e) { toast('No se pudo leer el historial guardado; se usa el de este navegador.'); readLocal(); }
    } else readLocal();
  }
  function readLocal() { const h = LS.get('history'); if (h) Object.assign(S.history, h); const c = LS.get('config'); if (c) mergeConfig(c); }
  function mergeConfig(c) { if (c.meta) S.config.meta = Object.assign({}, S.config.meta, c.meta); if (c.patronoMap) S.config.patronoMap = Object.assign({}, S.config.patronoMap, c.patronoMap); }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  let saveCfgT = null;
  function saveConfig() {
    clearTimeout(saveCfgT);
    saveCfgT = setTimeout(async () => {
      const body = { meta: S.config.meta, patronoMap: S.config.patronoMap };
      LS.set('config', body);
      if (gsOn()) { if (!puede('saveConfig')) return; try { await gsPost({ action: 'saveConfig', config: body }); } catch (e) { toast('No se guardó la configuración en Sheets: ' + e.message); } }
      else if (S.store) { try { await S.store.collection('data/users/' + S.uid).doc('config').set(body); } catch (e) { } }
    }, 700);
  }
  async function saveMonth(agg, md, reps) {
    const all = Object.assign({}, LS.get('history') || {}); all[agg.month] = agg; LS.set('history', all);
    if (gsOn()) { try { loader(true, 'Guardando en Google Sheets…', 95); await gsSaveMonth(agg, md, reps); return 'sheets'; } catch (e) { S.saveErr = { month: agg.month, msg: e.message }; showSaveErr(); return false; } }
    if (S.store) { try { await S.store.collection('data/users/' + S.uid).doc('m' + agg.month.replace('-', '')).set(agg); return true; } catch (e) { toast('Guardado solo en este navegador (' + (e.code || 'error') + ').'); } }
    return false;
  }
  function showSaveErr() {
    let el = document.getElementById('saveWarn'); if (!S.saveErr) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'saveWarn'; el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;max-width:680px;width:calc(100% - 32px);background:#3b1d0a;border:1px solid #f59e0b;color:#fde68a;border-radius:14px;padding:12px 16px;display:flex;gap:12px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:13px'; document.body.appendChild(el); }
    el.innerHTML = `<div style="flex:1"><b>No se guardó ${esc(C.monthLabel(S.saveErr.month))} en Google Sheets.</b> ${esc(S.saveErr.msg || '')}. Lo ves aquí, pero otros usuarios y otros equipos no lo verán hasta que se guarde.</div><button class="btn pri sm" id="swRetry">Reintentar</button><button class="btn sm ghost" id="swX">✕</button>`;
    el.querySelector('#swX').onclick = () => { el.remove(); };
    el.querySelector('#swRetry').onclick = async () => {
      const ym = S.saveErr.month, m = S.models[ym]; el.querySelector('#swRetry').disabled = true; el.querySelector('#swRetry').textContent = 'Guardando…';
      try { await gsSaveMonth(S.history[ym], m && !m.fromSheets ? m.model : null, m && m.reports); S.saveErr = null; showSaveErr(); toast(`${C.monthLabel(ym)} guardado en Google Sheets con el detalle y los reportes originales.`, 6000); renderAll(); }
      catch (e) { S.saveErr.msg = e.message; showSaveErr(); }
    };
  }
  async function deleteMonth(ym) {
    if (!puede('deleteMonth')) { toast('Tu rol no permite borrar meses.'); return; }
    delete S.history[ym]; delete S.models[ym];
    const all = LS.get('history') || {}; delete all[ym]; LS.set('history', all);
    if (gsOn()) { try { await gsPost({ action: 'deleteMonth', month: ym }); } catch (e) { toast('No se pudo borrar en Sheets: ' + e.message); } }
    else if (S.store) { try { await S.store.collection('data/users/' + S.uid).doc('m' + ym.replace('-', '')).delete(); } catch (e) { } }
  }

  // ---------- utilidades UI ----------
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), ms || 3200); }
  function loader(on, tx, p) { $('#loader').classList.toggle('on', !!on); if (tx) $('#loaderTx').textContent = tx; if (p != null) $('#loaderBar').style.width = p + '%'; }
  const months = () => Object.keys(S.history).sort();
  const agg = () => S.history[S.current];
  const prevAgg = () => { const m = months(); const i = m.indexOf(S.current); return i > 0 ? S.history[m[i - 1]] : null; };
  const model = () => S.models[S.current] && S.models[S.current].model;
  const origLoading = {};
  const reports = () => { const m = S.models[S.current]; return (m && m.reports && m.reports.length) ? m.reports : ((S.orig && S.orig[S.current]) || []); };
  // Trae los reportes originales guardados en Sheets (para Ver reportes y Cuadre en otros equipos)
  const puedeTraerOriginales = ym => ym && gsOn() && S.gsDetalle[ym] && puede('getFiles') && !(S.orig && S.orig[ym]);
  function ensureOriginals(ym, done) {
    if (origLoading[ym]) return; origLoading[ym] = true;
    loadOriginals(ym).then(list => { S.orig = S.orig || {}; S.orig[ym] = list; if (S.current === ym) done(); })
      .catch(e => toast('No se pudieron traer los reportes: ' + e.message, 6000)).finally(() => { origLoading[ym] = false; });
  }
  const needDetail = (what) => {
    const ym = S.current, lab = esc(C.monthLabel(ym));
    if (gsOn() && S.history[ym] && S.gsDetalle[ym] && !S.models[ym]) return `<div class="empty"><b>Trayendo el detalle de ${lab} desde Google Sheets…</b>Tarda unos segundos.</div>`;
    if (gsOn() && S.history[ym] && !S.gsDetalle[ym]) return `<div class="empty"><b>${lab} está guardado solo con totales</b>En Google Sheets este mes no tiene el detalle por cliente ni los reportes originales${S.saveErr && S.saveErr.month === ym ? ' porque la última carga no se pudo guardar' : ''}. Vuelve a cargar sus reportes una vez con <b style="display:inline">Cargar mes</b> y quedará completo para todos los usuarios.</div>`;
    return `<div class="empty"><b>Falta el detalle de ${lab}</b>${esc(what || 'Esta sección usa el detalle por cliente.')} Carga los reportes del mes con <b style="display:inline">Cargar mes</b>.</div>`;
  };
  function delta(cur, prev, opts) {
    opts = opts || {};
    if (prev == null || !isFinite(prev) || prev === 0 && !opts.pp) return '';
    const d = opts.pp ? (cur - prev) * 100 : (cur - prev) / Math.abs(prev) * 100;
    if (Math.abs(d) < 0.05) return `<span class="chip">= vs mes ant.</span>`;
    const good = opts.inverse ? d < 0 : d > 0;
    return `<span class="chip ${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}${opts.pp ? ' pp' : '%'}</span>`;
  }
  function kpiCard(lb, vl, sb, color) {
    return `<div class="card kpi tilt"><div class="glow" style="background:${color || '#38bdf8'}"></div><div class="lb">${lb}</div><div class="vl">${vl}</div><div class="sb">${sb || ''}</div></div>`;
  }
  function enableTilt(root) {
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    $$('.tilt', root).forEach(el => {
      el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5; const y = (e.clientY - r.top) / r.height - .5; el.style.transform = `perspective(700px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateZ(6px)`; });
      el.addEventListener('pointerleave', () => el.style.transform = '');
    });
  }

  // ---------- tablas ----------
  function table(el, cols, rows, opts) {
    opts = opts || {};
    const st = { q: '', sort: opts.sort != null ? opts.sort : -1, dir: opts.dir || -1, page: 0, filter: null };
    const size = opts.pageSize || 50;
    el.innerHTML = `<div class="tools">${opts.search !== false ? '<input class="inp" placeholder="Buscar…" style="flex:1;min-width:150px">' : ''}${opts.toolsHtml || ''}<span class="muted cnt" style="font-size:12px"></span></div><div class="tbl-wrap"><table class="t"><thead><tr>${cols.map((c, i) => `<th data-i="${i}" class="${c.n ? 'n' : ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody></tbody>${opts.total ? '<tfoot><tr></tr></tfoot>' : ''}</table></div><div class="tools mt pager" style="justify-content:flex-end"></div>`;
    const inp = $('input.inp', el);
    const draw = () => {
      let r = rows;
      if (st.filter) r = r.filter(st.filter);
      if (st.q) { const q = st.q.toLowerCase(); r = r.filter(x => cols.some(c => String(c.v(x) == null ? '' : c.v(x)).toLowerCase().includes(q))); }
      if (st.sort >= 0) { const c = cols[st.sort]; r = r.slice().sort((a, b) => { const x = c.v(a), y = c.v(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; }); }
      const pages = Math.max(1, Math.ceil(r.length / size)); st.page = Math.min(st.page, pages - 1);
      const pr = r.slice(st.page * size, st.page * size + size);
      $('tbody', el).innerHTML = pr.map(x => `<tr>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(c.v(x), x) : esc(c.v(x))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:20px">Sin resultados</td></tr>`;
      if (opts.total) $('tfoot tr', el).innerHTML = cols.map((c, i) => `<td class="${c.n ? 'n' : ''}">${i === 0 ? 'Total (' + int(r.length) + ')' : c.sum ? (c.f ? c.f(r.reduce((s, x) => s + (+c.v(x) || 0), 0)) : r.reduce((s, x) => s + (+c.v(x) || 0), 0)) : ''}</td>`).join('');
      $('.cnt', el).textContent = int(r.length) + ' filas';
      $('.pager', el).innerHTML = pages > 1 ? `<button class="btn sm" data-p="-1">‹</button><span class="muted" style="font-size:12px">Página ${st.page + 1} de ${pages}</span><button class="btn sm" data-p="1">›</button>` : '';
      $$('.pager button', el).forEach(b => b.onclick = () => { st.page = Math.max(0, Math.min(pages - 1, st.page + +b.dataset.p)); draw(); });
    };
    if (inp) inp.oninput = () => { st.q = inp.value; st.page = 0; draw(); };
    $$('th', el).forEach(th => th.onclick = () => { const i = +th.dataset.i; if (st.sort === i) st.dir *= -1; else { st.sort = i; st.dir = cols[i].n ? -1 : 1; } draw(); });
    draw();
    return { setFilter(f) { st.filter = f; st.page = 0; draw(); }, redraw: draw };
  }

  // ---------- gráficos ----------
  const charts = {};
  function chart(id, opt, gl) {
    const el = document.getElementById(id); if (!el) return null;
    if (charts[id]) { charts[id].dispose(); delete charts[id]; }
    const c = echarts.init(el, null, { renderer: gl ? 'canvas' : 'canvas' });
    c.setOption(Object.assign({ backgroundColor: 'transparent', textStyle: { fontFamily: 'Inter', color: '#9fb0d8' }, animationDuration: 900, animationEasing: 'cubicOut' }, opt));
    charts[id] = c; return c;
  }
  window.addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()));
  const axisStyle = { axisLine: { lineStyle: { color: 'rgba(140,170,255,.25)' } }, axisLabel: { color: '#9fb0d8', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(140,170,255,.08)' } } };
  const tip = (extra) => Object.assign({ trigger: 'axis', backgroundColor: 'rgba(12,20,44,.95)', borderColor: 'rgba(129,140,248,.5)', textStyle: { color: '#e8eeff', fontSize: 12 }, axisPointer: { type: 'shadow' } }, extra || {});
  const grad = (a, b, horiz) => new echarts.graphic.LinearGradient(0, horiz ? 0 : 1, horiz ? 1 : 0, 0, [{ offset: 0, color: b }, { offset: 1, color: a }]);
  // Barras tipo cilindro 3D
  function cylinder(cats, vals, colors, opt) {
    opt = opt || {}; const w = opt.w || 28;
    const col = i => Array.isArray(colors) ? colors[i % colors.length] : colors;
    const data = vals.map((v, i) => ({ value: v, itemStyle: { color: grad(col(i), shade(col(i), -0.45)) } }));
    return [
      { type: 'bar', barWidth: w, data, z: 2, label: opt.label ? { show: true, position: 'top', distance: 10, color: '#e8eeff', fontSize: 11, formatter: p => opt.label(p.value) } : undefined, name: opt.name },
      { type: 'pictorialBar', symbol: 'ellipse', symbolSize: [w, w * 0.32], symbolOffset: [0, '-50%'], symbolPosition: 'end', z: 3, data: vals.map((v, i) => ({ value: v, itemStyle: { color: shade(col(i), 0.25) } })), tooltip: { show: false } },
      { type: 'pictorialBar', symbol: 'ellipse', symbolSize: [w, w * 0.32], symbolOffset: [0, '50%'], z: 1, data: vals.map((v, i) => ({ value: v, itemStyle: { color: shade(col(i), -0.5) } })), tooltip: { show: false } }
    ];
  }
  function shade(hex, p) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255;
    const t = p < 0 ? 0 : 255; p = Math.abs(p);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  const shortName = s => String(s).replace(/^BANCA PERSONAL-/, '').replace(/^PREST(AMO)? PERSONAL /, '').replace(/PRESTAMOS /, '').replace(/ VADA$/, 'VADA').slice(0, 22);

  // ---------- insights ----------
  function insights(a, p) {
    const k = a.kpi, out = [];
    const mig = k.carteraMig / (k.cartera || 1);
    out.push({ t: k.par30Pct > .3 ? 'bad' : k.par30Pct > .1 ? 'warn' : 'good', x: `La cartera en riesgo a más de 30 días (PAR30) es ${pct(k.par30Pct)} (${short(k.par30)} de ${short(k.cartera)}).` });
    if (k.migrados) out.push({ t: 'warn', x: `Los ${int(k.migrados)} préstamos migrados suman ${short(k.carteraMig)} (${pct(mig)} de la cartera). Sin ellos, el PAR30 baja a ${pct(k.par30NMPct)} sobre ${short(k.carteraNM)}.` });
    const b = a.byBucket; const recup = b[1].moroso + b[2].moroso + b[3].moroso; const nrec = b[1].n + b[2].n + b[3].n;
    if (nrec) out.push({ t: 'warn', x: `${int(nrec)} préstamos están entre 31 y 120 días, con ${money0(recup)} en cuotas vencidas: es la mora más recuperable y debe ir primero en la gestión.` });
    const mf = C.metaFromAgg(p || a, S.config.meta, p ? 'sig' : 'mes');
    const cumpl = mf.meta ? k.recaudo / mf.meta : 0;
    out.push({ t: cumpl >= 1 ? 'good' : cumpl >= .85 ? 'warn' : 'bad', x: `Se recaudaron ${money0(k.recaudo)} contra una meta ${p ? 'fijada al cierre anterior' : 'estimada'} de ${money0(mf.meta)}: cumplimiento ${pct(cumpl, 0)}.` });
    const r0 = a.metaRows && a.metaRows[0]; if (r0 && (r0.cuotasMes || r0.cuotas)) out.push({ t: r0.real / (r0.cuotasMes || r0.cuotas) >= .95 ? 'good' : 'warn', x: `Los clientes al día pagaron ${money0(r0.real)} de ${money0(r0.cuotasMes != null ? r0.cuotasMes : r0.cuotas)} en letras del mes (${pct(r0.real / r0.cuotas, 0)}).` });
    if (k.canceladosN) out.push({ t: 'good', x: `${int(k.canceladosN)} préstamos se cancelaron en el mes por ${money0(k.canceladosMonto)}; parte del recaudo viene de esas cancelaciones.` });
    const topP = (a.byPatrono || []).filter(x => !/^Otros/.test(x.k)).sort((x, y) => y.par30 - x.par30)[0];
    if (topP && topP.par30) out.push({ t: 'warn', x: `El patrono con más cartera en riesgo es ${topP.k}: ${short(topP.par30)} en PAR30 (${int(topP.enMora)} de ${int(topP.n)} préstamos).` });
    if (p) {
      const pk = p.kpi;
      out.push({ t: k.cartera >= pk.cartera ? 'good' : 'warn', x: `Frente a ${p.label}, la cartera ${k.cartera >= pk.cartera ? 'creció' : 'bajó'} ${pct(Math.abs(k.cartera - pk.cartera) / (pk.cartera || 1))} y el PAR30 ${k.par30Pct <= pk.par30Pct ? 'mejoró' : 'empeoró'} ${Math.abs((k.par30Pct - pk.par30Pct) * 100).toFixed(1)} pp.` });
    }
    if (k.vencidosN) out.push({ t: 'bad', x: `${int(k.vencidosN)} préstamos ya pasaron su fecha de vencimiento con saldo pendiente de ${short(k.vencidosSaldo)}.` });
    return out;
  }
  function recomendaciones(a) {
    const k = a.kpi, b = a.byBucket, out = [];
    if (b[1].n + b[2].n + b[3].n) out.push('Llamar esta semana a los préstamos de 31 a 120 días y pactar arreglos de pago antes de que pasen a +120.');
    if (k.migrados) out.push('Separar la cartera migrada en el reporte a junta y definir una estrategia propia (castigo, venta o cobro judicial).');
    out.push('Conciliar con cada patrono los descuentos de planilla del mes para detectar empleados que dejaron de pagar.');
    if (k.vencidosN) out.push('Revisar los préstamos vencidos con saldo para refinanciar o iniciar cobro legal.');
    out.push('Fijar la meta del próximo mes en ' + money0(C.metaFromAgg(a, S.config.meta, 'sig').meta) + ' y darle seguimiento semanal por oficial.');
    return out;
  }

  // ---------- render: selector de mes ----------
  function renderMonthSel() {
    const sel = $('#monthSel'); const m = months();
    sel.innerHTML = m.length ? m.slice().reverse().map(x => `<option value="${x}" ${x === S.current ? 'selected' : ''}>${C.monthLabel(x)}${S.models[x] ? '' : ''}</option>`).join('') : '<option>Sin datos</option>';
    const a = agg();
    $('#subtitle').textContent = a ? `Cierre ${a.label} · ${int(a.kpi.prestamos)} préstamos${S.models[S.current] ? (S.models[S.current].fromSheets ? ' · detalle desde Google Sheets' : ' · detalle cargado') : ''}${gsOn() && S.gsStatus === 'ok' ? (S.gsDetalle[S.current] ? ' · guardado completo en Google Sheets' : ' · en Google Sheets solo con totales') : ''}` : 'Carga los reportes del mes';
  }

  // ---------- RESUMEN ----------
  const emptyCTA = () => `<div class="card empty" style="padding:56px 18px"><div class="drop" style="border:0;background:none;padding:0;cursor:default"><div class="big"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg></div></div><b>Sube los reportes del mes para empezar</b>El dashboard no trae datos: lee los Excel del SIF que cargues, arma los gráficos y genera el Excel GSF, el análisis y la presentación. Los archivos se procesan solo en tu navegador.<div class="mt"><button class="btn pri" onclick="document.getElementById('fileIn').click()">Cargar reportes</button></div></div>`;
  function renderResumen() {
    const v = $('#v-resumen'); const a = agg();
    if (!a) { v.innerHTML = emptyCTA(); return; }
    const p = prevAgg(), k = a.kpi, pk = p && p.kpi;
    const mf = C.metaFromAgg(p || a, S.config.meta, p ? 'sig' : 'mes'); const cumpl = mf.meta ? k.recaudo / mf.meta : 0;
    v.innerHTML = `
      <div class="vhead"><div><h2>Resumen del cierre · ${esc(a.label)}</h2><p>Foto de la cartera activa al cierre: tamaño, calidad, cobros e ingresos del mes.</p></div></div>
      <div class="grid g-kpi">
        ${kpiCard('Cartera total', short(k.cartera), `${int(k.prestamos)} préstamos ${delta(k.cartera, pk && pk.cartera)}`, '#38bdf8')}
        ${kpiCard('PAR30', pct(k.par30Pct), `${short(k.par30)} en riesgo ${delta(k.par30Pct, pk && pk.par30Pct, { pp: true, inverse: true })}`, '#f87171')}
        ${kpiCard('PAR30 sin migrados', pct(k.par30NMPct), `sobre ${short(k.carteraNM)}`, '#fb923c')}
        ${kpiCard('Saldo moroso', short(k.moroso), `${pct(k.morosoPct)} de la cartera`, '#e11d48')}
        ${kpiCard('Recaudo del mes', short(k.recaudo), `<span class="chip ${cumpl >= 1 ? 'up' : cumpl >= .85 ? 'warn' : 'down'}">${pct(cumpl, 0)} de la meta</span> ${delta(k.recaudo, pk && pk.recaudo)}`, '#34d399')}
        ${kpiCard('Intereses + GM del mes', short(k.interesesMes + k.gmMes), `Int ${short(k.interesesMes)} · GM ${short(k.gmMes)}`, '#818cf8')}
        ${a.deep ? kpiCard('25 mayores clientes', pct(a.deep.top25Pct), `de la cartera · <a href="#analisis" style="color:#93c5fd">ver lista</a>`, '#a78bfa') : ''}
      </div>
      <div class="grid g21 mt">
        <div class="card"><h3>Cartera por producto y tramo de mora <small>3D · arrastra para girar</small></h3><div id="c3d" class="chart tall"></div></div>
        <div class="card"><h3>Composición por producto</h3><div id="cProd" class="chart tall"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Saldo por tramo de mora</h3><div id="cTramos" class="chart"></div></div>
        <div class="card"><h3>Hallazgos del mes</h3><ul class="ins" id="insList"></ul></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Cartera por sucursal</h3><div id="cSuc" class="chart"></div></div>
        <div class="card"><h3>Evolución mensual <small>${months().length} ${months().length === 1 ? 'mes' : 'meses'} en el historial</small></h3><div id="cTrend" class="chart"></div></div>
      </div>`;
    enableTilt(v);
    $('#insList').innerHTML = insights(a, p).map(i => `<li class="${i.t}"><i></i><span>${esc(i.x)}</span></li>`).join('');
    // 3D
    const prods = a.byProduct.map(x => shortName(x.k));
    const d3 = []; a.byProduct.forEach((x, i) => (x.b || []).forEach((s, j) => { if (s > 0) d3.push([i, j, Math.round(s)]); }));
    const max3 = Math.max(1, ...d3.map(d => d[2]));
    loadScript('echartsgl').then(() => {
      chart('c3d', {
        tooltip: { formatter: p => `${prods[p.value[0]]}<br>${C.BUCKETS[p.value[1]]} días: <b>${money0(p.value[2])}</b>` },
        visualMap: { show: false, min: 0, max: max3, inRange: { color: ['#1e3a8a', '#2563eb', '#38bdf8', '#a78bfa', '#f472b6', '#fb7185'] } },
        xAxis3D: { type: 'category', data: prods, name: '', axisLabel: { color: '#9fb0d8', fontSize: 10, interval: 0 }, axisLine: { lineStyle: { color: '#334' } } },
        yAxis3D: { type: 'category', data: C.BUCKETS, name: '', axisLabel: { color: '#9fb0d8', fontSize: 10 } },
        zAxis3D: { type: 'value', name: '', axisLabel: { color: '#9fb0d8', fontSize: 10, formatter: v => short(v) } },
        grid3D: { boxWidth: 190, boxDepth: 95, boxHeight: 85, top: -10, viewControl: { alpha: 20, beta: 36, distance: 185, minDistance: 120, maxDistance: 320, autoRotate: true, autoRotateSpeed: 6, autoRotateAfterStill: 4 }, light: { main: { intensity: 1.3, shadow: true, alpha: 40, beta: 30 }, ambient: { intensity: .35 } }, axisPointer: { lineStyle: { color: '#38bdf8' } }, splitLine: { lineStyle: { color: 'rgba(140,170,255,.12)' } }, axisLine: { lineStyle: { color: 'rgba(140,170,255,.3)' } }, environment: 'none' },
        series: [{ type: 'bar3D', data: d3, shading: 'lambert', bevelSize: .3, bevelSmoothness: 4, itemStyle: { opacity: .95 }, emphasis: { itemStyle: { color: '#fde047' }, label: { show: false } } }]
      }, true);
    }).catch(() => { $('#c3d').innerHTML = '<div class="empty">No se pudo cargar el motor 3D.</div>'; });
    chart('cProd', {
      tooltip: { trigger: 'item', formatter: p => `${p.name}<br><b>${money0(p.value)}</b> · ${p.percent}%` },
      legend: { bottom: 0, type: 'scroll', textStyle: { color: '#9fb0d8', fontSize: 11 }, pageTextStyle: { color: '#9fb0d8' } },
      series: [{ type: 'pie', radius: ['42%', '70%'], center: ['50%', '44%'], itemStyle: { borderRadius: 8, borderColor: '#0b1226', borderWidth: 2, shadowBlur: 20, shadowColor: 'rgba(0,0,0,.5)' }, label: { color: '#cbd5f5', fontSize: 10.5, formatter: p => p.percent > 2.5 ? `${p.name}\n${p.percent.toFixed(0)}%` : '' }, labelLine: { length: 8, length2: 6 }, data: a.byProduct.map((x, i) => ({ name: shortName(x.k), value: x.saldo, itemStyle: { color: PAL[i % PAL.length] } })) }]
    });
    chart('cTramos', { tooltip: tip({ formatter: ps => { const i = ps[0].dataIndex; const b = a.byBucket[i]; return `${b.k} días<br>Saldo: <b>${money0(b.saldo)}</b><br>Préstamos: ${b.n}<br>Moroso: ${money0(b.moroso)}`; } }), grid: { left: 60, right: 14, top: 30, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: C.BUCKETS }, axisStyle), yAxis: Object.assign({ type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) } }, { splitLine: axisStyle.splitLine }), series: cylinder(C.BUCKETS, a.byBucket.map(b => b.saldo), BCOL, { w: 30, label: v => short(v) }) });
    const suc = a.bySucursal;
    chart('cSuc', { tooltip: tip({ formatter: ps => `${suc[ps[0].dataIndex].k}<br><b>${money0(suc[ps[0].dataIndex].saldo)}</b> · ${suc[ps[0].dataIndex].n} préstamos` }), grid: { left: 110, right: 50, top: 10, bottom: 20 }, xAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, yAxis: { type: 'category', inverse: true, data: suc.map(s => s.k.replace(/^\d+\s/, '')), axisLabel: { color: '#cbd5f5' }, axisLine: axisStyle.axisLine },
      series: [{ type: 'bar', data: suc.map((s, i) => ({ value: s.saldo, itemStyle: { color: grad('#38bdf8', '#6366f1', true), borderRadius: [0, 8, 8, 0], shadowBlur: 12, shadowColor: 'rgba(56,189,248,.35)', shadowOffsetY: 4 } })), barWidth: 16, label: { show: true, position: 'right', color: '#e8eeff', fontSize: 11, formatter: p => short(p.value) } }] });
    const ms = months(); const H = ms.map(m => S.history[m]);
    chart('cTrend', { tooltip: tip({ axisPointer: { type: 'line' } }), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 50, top: 36, bottom: 30 },
      xAxis: Object.assign({ type: 'category', data: H.map(h => h.label.slice(0, 3) + ' ' + h.month.slice(2, 4)) }, axisStyle),
      yAxis: [{ type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => v + '%' }, splitLine: { show: false } }],
      series: [{ name: 'Cartera', type: 'bar', barWidth: 26, data: H.map(h => h.kpi.cartera), itemStyle: { color: grad('#38bdf8', '#1e40af'), borderRadius: [8, 8, 0, 0] } }, { name: 'Recaudo', type: 'bar', barWidth: 26, data: H.map(h => h.kpi.recaudo), itemStyle: { color: grad('#34d399', '#065f46'), borderRadius: [8, 8, 0, 0] } }, { name: 'PAR30 %', type: 'line', yAxisIndex: 1, smooth: true, symbolSize: 9, data: H.map(h => +(h.kpi.par30Pct * 100).toFixed(1)), lineStyle: { width: 3, color: '#f87171' }, itemStyle: { color: '#f87171' } }] });
  }

  // ---------- MOROSIDAD ----------
  function renderMora() {
    const v = $('#v-morosidad'); const a = agg(); if (!a) { v.innerHTML = emptyCTA(); return; }
    const md = model(); const p = prevAgg();
    const k = a.kpi;
    const L = md ? md.loans.filter(l => S.moraMig || !l.migrado) : null;
    const bk = L ? C.BUCKETS.map((b, i) => { const g = L.filter(l => l.bucket === i); return { k: b, n: g.length, saldo: g.reduce((s, l) => s + l.saldo, 0), moroso: g.reduce((s, l) => s + l.totalMoroso, 0) }; }) : a.byBucket;
    const cart = bk.reduce((s, b) => s + b.saldo, 0); const par30 = bk.slice(1).reduce((s, b) => s + b.saldo, 0); const par90 = bk.slice(3).reduce((s, b) => s + b.saldo, 0); const mor = bk.reduce((s, b) => s + b.moroso, 0);
    v.innerHTML = `
      <div class="vhead"><div><h2>Análisis de morosidad · ${esc(a.label)}</h2><p>Mora por días de atraso al cierre, antigüedad del saldo vencido y dónde se concentra.</p></div>
        <div class="seg" id="migSeg"><button data-m="1" class="${S.moraMig ? 'on' : ''}">Con migrados</button><button data-m="0" class="${!S.moraMig ? 'on' : ''}" ${md ? '' : 'disabled title="Requiere el detalle del mes"'}>Sin migrados</button></div></div>
      <div class="grid g-kpi">
        ${kpiCard('PAR30', pct(par30 / (cart || 1)), short(par30) + ' con más de 30 días', '#f87171')}
        ${kpiCard('PAR90', pct(par90 / (cart || 1)), short(par90) + ' con más de 90 días', '#e11d48')}
        ${kpiCard('Cuotas vencidas', short(mor), pct(mor / (cart || 1)) + ' del saldo', '#fb923c')}
        ${kpiCard('Préstamos en mora', int(bk.slice(1).reduce((s, b) => s + b.n, 0)), 'de ' + int(bk.reduce((s, b) => s + b.n, 0)) + ' activos', '#fbbf24')}
        ${kpiCard('Recuperables 31–120 días', int(bk[1].n + bk[2].n + bk[3].n), money0(bk[1].moroso + bk[2].moroso + bk[3].moroso) + ' vencido', '#a3e635')}
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Préstamos y saldo por tramo</h3><div id="mTramo" class="chart"></div></div>
        <div class="card"><h3>Antigüedad del saldo moroso <small>dinero vencido por edad</small></h3><div id="mAging" class="chart"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Mapa de calor: producto × tramo</h3><div id="mHeat" class="chart tall"></div></div>
        <div class="card"><h3>Patronos con más cartera en riesgo</h3><div id="mPat" class="chart tall"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Mora por oficial de crédito</h3><div id="mOfi" class="chart"></div></div>
        <div class="card" id="rollCard"><h3>Movimiento entre tramos <small>vs mes anterior</small></h3><div id="rollBox"></div></div>
      </div>
      <div class="card mt"><h3>Clientes en mora <small>detalle por préstamo</small></h3><div id="moraTbl">${md ? '' : needDetail('La lista de clientes en mora se arma con los reportes del mes.')}</div></div>`;
    enableTilt(v);
    $$('#migSeg button').forEach(b => b.onclick = () => { S.moraMig = b.dataset.m === '1'; renderMora(); });
    chart('mTramo', { tooltip: tip(), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 50, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: C.BUCKETS }, axisStyle),
      yAxis: [{ type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, { type: 'value', axisLabel: { color: '#9fb0d8' }, splitLine: { show: false } }],
      series: [Object.assign(cylinder(C.BUCKETS, bk.map(b => Math.round(b.saldo)), BCOL, { w: 30, name: 'Saldo' })[0], { name: 'Saldo' }), cylinder(C.BUCKETS, bk.map(b => Math.round(b.saldo)), BCOL, { w: 30 })[1], cylinder(C.BUCKETS, bk.map(b => Math.round(b.saldo)), BCOL, { w: 30 })[2], { name: 'Préstamos', type: 'line', yAxisIndex: 1, data: bk.map(b => b.n), symbolSize: 9, smooth: true, lineStyle: { color: '#e8eeff', width: 2 }, itemStyle: { color: '#e8eeff' }, label: { show: true, color: '#e8eeff', fontSize: 11, position: 'top' } }] });
    const ag = L ? C.AGING.map((x, i) => L.reduce((s, l) => s + (l.aging ? l.aging[i] : 0), 0)) : a.agingTot;
    chart('mAging', { tooltip: tip({ valueFormatter: v => money0(v) }), grid: { left: 60, right: 14, top: 20, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: C.AGING.map(x => x === 'Mas 365' ? '+365' : x + ' d') }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine },
      series: [{ type: 'bar', data: ag.map((x, i) => ({ value: Math.round(x), itemStyle: { color: grad(['#a3e635', '#fbbf24', '#fbbf24', '#fb923c', '#fb923c', '#f87171', '#e11d48'][i], '#1e1b4b'), borderRadius: [8, 8, 0, 0], shadowBlur: 14, shadowColor: 'rgba(0,0,0,.5)', shadowOffsetY: 6 } })), barWidth: '55%', label: { show: true, position: 'top', color: '#e8eeff', fontSize: 10.5, formatter: p => short(p.value) } }] });
    // heat
    let prodRows;
    if (L) { const m = new Map(); L.forEach(l => { const g = m.get(l.producto) || { k: l.producto, b: [0, 0, 0, 0, 0, 0], saldo: 0 }; g.b[l.bucket] += l.saldo; g.saldo += l.saldo; m.set(l.producto, g); }); prodRows = [...m.values()].sort((x, y) => y.saldo - x.saldo); }
    else prodRows = a.byProduct;
    const hd = []; prodRows.forEach((x, i) => (x.b || []).forEach((s, j) => hd.push([j, i, Math.round(s)])));
    chart('mHeat', { tooltip: { formatter: p => `${shortName(prodRows[p.value[1]].k)}<br>${C.BUCKETS[p.value[0]]}: <b>${money0(p.value[2])}</b>` }, grid: { left: 8, right: 10, top: 10, bottom: 70, containLabel: true }, xAxis: { type: 'category', data: C.BUCKETS, axisLabel: { color: '#9fb0d8', fontSize: 10.5 }, splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,.01)', 'rgba(255,255,255,.03)'] } } }, yAxis: { type: 'category', data: prodRows.map(x => shortName(x.k).slice(0, 18)), axisLabel: { color: '#cbd5f5', fontSize: 10.5 } },
      visualMap: { min: 0, max: Math.max(1, ...hd.map(h => h[2])), calculable: true, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, textStyle: { color: '#9fb0d8' }, inRange: { color: ['#0f1a3a', '#1d4ed8', '#7c3aed', '#db2777', '#f43f5e'] }, formatter: v => short(v) },
      series: [{ type: 'heatmap', data: hd, label: { show: true, color: '#fff', fontSize: 9.5, formatter: p => p.value[2] ? short(p.value[2]) : '' }, itemStyle: { borderColor: '#0b1226', borderWidth: 2, borderRadius: 4 } }] });
    let pats;
    if (L) { const m = new Map(); L.forEach(l => { const g = m.get(l.patrono) || { k: l.patrono, par30: 0, n: 0, enMora: 0 }; g.n++; if (l.bucket > 0) { g.par30 += l.saldo; g.enMora++; } m.set(l.patrono, g); }); pats = [...m.values()]; } else pats = a.byPatrono.filter(x => !/^Otros/.test(x.k));
    pats = pats.filter(x => x.par30 > 0).sort((x, y) => y.par30 - x.par30).slice(0, 10);
    chart('mPat', { tooltip: tip({ formatter: ps => { const x = pats[ps[0].dataIndex]; return `${esc(x.k)}<br>PAR30: <b>${money0(x.par30)}</b><br>${x.enMora} de ${x.n} préstamos en mora`; } }), grid: { left: 10, right: 60, top: 10, bottom: 10, containLabel: true }, xAxis: { type: 'value', axisLabel: { show: false }, splitLine: axisStyle.splitLine }, yAxis: { type: 'category', inverse: true, data: pats.map(x => x.k.length > 26 ? x.k.slice(0, 25) + '…' : x.k), axisLabel: { color: '#cbd5f5', fontSize: 10.5 } },
      series: [{ type: 'bar', barWidth: 14, data: pats.map(x => ({ value: Math.round(x.par30), itemStyle: { color: grad('#fb7185', '#7c3aed', true), borderRadius: [0, 8, 8, 0], shadowBlur: 10, shadowColor: 'rgba(244,63,94,.35)' } })), label: { show: true, position: 'right', color: '#e8eeff', fontSize: 10.5, formatter: p => short(p.value) } }] });
    const ofs = L ? (() => { const m = new Map(); L.forEach(l => { const g = m.get(l.oficial) || { k: l.oficial, saldo: 0, par30: 0 }; g.saldo += l.saldo; if (l.bucket > 0) g.par30 += l.saldo; m.set(l.oficial, g); }); return [...m.values()]; })() : a.byOficial;
    chart('mOfi', { tooltip: tip({ valueFormatter: v => money0(v) }), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 14, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: ofs.map(o => o.k) }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine },
      series: [{ name: 'Al día', type: 'bar', stack: 's', data: ofs.map(o => Math.round(o.saldo - o.par30)), itemStyle: { color: grad('#34d399', '#065f46') }, barWidth: 34 }, { name: 'En riesgo (+30)', type: 'bar', stack: 's', data: ofs.map(o => Math.round(o.par30)), itemStyle: { color: grad('#f87171', '#7f1d1d'), borderRadius: [8, 8, 0, 0] } }] });
    // roll
    const roll = C.rollMatrix(p, a);
    const rb = $('#rollBox');
    if (!roll) rb.innerHTML = `<div class="empty"><b>Se activa con el segundo mes</b>Cuando cargues el próximo cierre verás cuántos préstamos pasaron de un tramo a otro (por ejemplo, de 0–30 a 31–60) y cuántos se curaron.</div>`;
    else {
      const M = roll.M;
      rb.innerHTML = `<div class="tbl-wrap"><table class="t"><thead><tr><th>Antes ↓ / Ahora →</th>${C.BUCKETS.map(b => `<th class="n">${b}</th>`).join('')}<th class="n">Salieron</th></tr></thead><tbody>${M.map((row, i) => `<tr><td><span class="badge b${i}">${C.BUCKETS[i]}</span></td>${row.map((c, j) => `<td class="n" style="${c.n ? `background:${j > i ? 'rgba(248,113,113,' : j < i ? 'rgba(52,211,153,' : 'rgba(148,163,184,'}${Math.min(.45, .08 + c.n / 60)})` : ''}">${c.n || ''}</td>`).join('')}<td class="n">${roll.salieron[i].n || ''}</td></tr>`).join('')}<tr><td class="muted">Nuevos</td>${roll.nuevos.map(c => `<td class="n">${c.n || ''}</td>`).join('')}<td></td></tr></tbody></table></div><div class="legend-row"><span><i style="background:#f87171"></i>empeoraron</span><span><i style="background:#34d399"></i>mejoraron</span><span><i style="background:#94a3b8"></i>igual</span></div>`;
    }
    if (L) {
      const rows = L.filter(l => l.bucket > 0 || l.totalMoroso > 0);
      const opts = '<select class="sel" id="fTramo"><option value="">Todos los tramos</option>' + C.BUCKETS.slice(1).map((b, i) => `<option value="${i + 1}">${b} días</option>`).join('') + '</select>';
      const tb = table($('#moraTbl'), [
        { h: 'Contrato', v: l => l.id }, { h: 'Cliente', v: l => l.nombre }, { h: 'Patrono', v: l => l.patrono }, { h: 'Oficial', v: l => l.oficial },
        { h: 'Tramo', v: l => l.bucket, f: (b) => `<span class="badge b${b}">${C.BUCKETS[b]}</span>` }, { h: 'Días', v: l => l.dias, n: 1, f: int },
        { h: 'Saldo', v: l => l.saldo, n: 1, f: money, sum: 1 }, { h: 'Moroso', v: l => l.totalMoroso, n: 1, f: money, sum: 1 }, { h: 'Cuota mes', v: l => l.cuotaMes, n: 1, f: money },
        { h: 'Últ. pago', v: l => l.fult || '', f: dd }, { h: 'Pagó en el mes', v: l => l.pagadoMes, n: 1, f: money, sum: 1 }, { h: 'Días hoy', v: l => l.diasHoy == null ? '' : l.diasHoy, n: 1 }
      ], rows, { sort: 7, total: true, toolsHtml: opts });
      $('#fTramo').onchange = e => { const b = e.target.value; tb.setFilter(b ? (l => l.bucket === +b) : null); };
    }
  }


  // ---------- ANÁLISIS A FONDO ----------
  function renderAnalisis() {
    const v = $('#v-analisis'); const a = agg(); if (!a) { v.innerHTML = emptyCTA(); return; }
    const d = a.deep; const md = model();
    if (!d) { v.innerHTML = `<div class="card">${needDetail('Este mes se guardó con una versión anterior del dashboard.')}</div>`; return; }
    const k = a.kpi;
    v.innerHTML = `
      <div class="vhead"><div><h2>Análisis a fondo · ${esc(a.label)}</h2><p>Concentración, mayores clientes, cosechas, vencimientos, tasas, antigüedad del último pago y composición del saldo.</p></div>
        <div class="tools" style="margin:0"><button class="btn" id="anaXls" ${md ? '' : 'disabled title="Requiere los reportes del mes"'}>Excel del análisis</button></div></div>
      <div class="grid g-kpi">
        ${kpiCard('25 mayores clientes', pct(d.top25Pct), 'de la cartera · top 10 = ' + pct(d.top10Pct), '#818cf8')}
        ${kpiCard('Cliente más grande', pct(d.top1Pct), 'de la cartera', '#a78bfa')}
        ${kpiCard('Tasa promedio', d.tasaProm.toFixed(2) + '%', 'ponderada por saldo · GM ' + d.gmProm.toFixed(2) + '%', '#38bdf8')}
        ${kpiCard('Plazo promedio', Math.round(d.plazoProm) + ' meses', int(d.clientes) + ' clientes', '#22d3ee')}
        ${kpiCard('Sin pagar hace +1 año', short(d.byLastPay.filter(x => /años|Nunca/.test(x.k)).reduce((s, x) => s + x.saldo, 0)), int(d.byLastPay.filter(x => /años|Nunca/.test(x.k)).reduce((s, x) => s + x.n, 0)) + ' préstamos', '#f87171')}
        ${kpiCard('Refinanciados', int((d.byRefi.find(x => x.k === 'Refinanciado') || {}).n || 0), short((d.byRefi.find(x => x.k === 'Refinanciado') || {}).saldo || 0) + ' de saldo', '#fbbf24')}
      </div>
      <div class="card mt"><h3>Los 25 mayores clientes <small>por saldo · concentran ${pct(d.top25Pct)} de la cartera</small></h3><div id="topTbl">${md ? '' : needDetail('La lista con nombres se arma con los reportes del mes; no se guarda en el historial.')}</div></div>
      <div class="grid g2 mt">
        <div class="card"><h3>Curva de concentración <small>% acumulado de la cartera por cliente</small></h3><div id="aPareto" class="chart"></div></div>
        <div class="card"><h3>Cosechas: saldo y mora por año de desembolso</h3><div id="aVin" class="chart"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Perfil de vencimiento del saldo</h3><div id="aMat" class="chart"></div></div>
        <div class="card"><h3>¿Hace cuánto pagaron por última vez?</h3><div id="aLp" class="chart"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Saldo por tasa de interés</h3><div id="aRate" class="chart"></div></div>
        <div class="card"><h3>Composición del saldo por tramo <small>capital, intereses, manejo, FECI, seguro</small></h3><div id="aComp" class="chart"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Refinanciados vs originales</h3><div id="aRefi" class="chart short"></div></div>
        <div class="card"><h3>Lo que dicen estos datos</h3><ul class="ins" id="anaIns"></ul></div>
      </div>`;
    enableTilt(v);
    $('#anaXls') && ($('#anaXls').onclick = downloadAnalysis);
    if (md) {
      const top = C.topClients(md, 25);
      table($('#topTbl'), [
        { h: '#', v: t => t.rank, n: 1 }, { h: 'Cliente', v: t => t.nombre }, { h: 'Cédula', v: t => t.cedula }, { h: 'Patrono', v: t => t.patrono }, { h: 'Oficial', v: t => t.oficial },
        { h: 'Saldo', v: t => t.saldo, n: 1, f: money, sum: 1 }, { h: '% cartera', v: t => t.pct, n: 1, f: x => pct(x, 2) }, { h: '% acum.', v: t => t.cumPct, n: 1, f: x => pct(x, 1) },
        { h: 'Tramo', v: t => t.bucket, f: b => `<span class="badge b${b}">${C.BUCKETS[b]}</span>` }, { h: 'Moroso', v: t => t.moroso, n: 1, f: money, sum: 1 }, { h: 'Cuota mes', v: t => t.cuotaMes, n: 1, f: money, sum: 1 },
        { h: 'Cobrado mes', v: t => t.pagadoMes, n: 1, f: money, sum: 1 }, { h: 'Últ. pago', v: t => t.fult || '', f: dd }
      ], top, { sort: 0, dir: 1, total: true, pageSize: 25 });
    }
    const curve = d.curve || [];
    chart('aPareto', { tooltip: tip({ axisPointer: { type: 'line' }, formatter: ps => `${Math.round((ps[0].dataIndex / Math.max(1, curve.length - 1)) * 100)}% de los clientes<br><b>${pct(ps[0].value)}</b> de la cartera` }), grid: { left: 50, right: 20, top: 20, bottom: 36 }, xAxis: { type: 'category', data: curve.map((_, i) => Math.round(i / Math.max(1, curve.length - 1) * 100) + '%'), name: '% de clientes', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: '#9fb0d8' }, axisLabel: { color: '#9fb0d8', interval: Math.floor(curve.length / 5) }, axisLine: axisStyle.axisLine },
      yAxis: { type: 'value', max: 1, axisLabel: { color: '#9fb0d8', formatter: v => (v * 100) + '%' }, splitLine: axisStyle.splitLine },
      series: [{ type: 'line', data: curve, smooth: true, showSymbol: false, lineStyle: { width: 3, color: '#818cf8' }, areaStyle: { color: grad('rgba(129,140,248,.5)', 'rgba(129,140,248,0)') }, markLine: { symbol: 'none', silent: true, lineStyle: { color: 'rgba(255,255,255,.25)', type: 'dashed' }, data: [[{ coord: [0, 0] }, { coord: [curve.length - 1, 1] }]] } }] });
    const vin = d.byVintage;
    chart('aVin', { tooltip: tip(), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 50, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: vin.map(x => x.k) }, axisStyle),
      yAxis: [{ type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, { type: 'value', max: 100, axisLabel: { color: '#9fb0d8', formatter: v => v + '%' }, splitLine: { show: false } }],
      series: [{ name: 'Saldo', type: 'bar', barWidth: '55%', data: vin.map(x => x.saldo), itemStyle: { color: grad('#38bdf8', '#1e3a8a'), borderRadius: [6, 6, 0, 0], shadowBlur: 10, shadowColor: 'rgba(56,189,248,.3)' }, tooltip: { valueFormatter: v => money0(v) } }, { name: 'PAR30 %', type: 'line', yAxisIndex: 1, data: vin.map(x => +(x.par30Pct * 100).toFixed(1)), symbolSize: 9, lineStyle: { color: '#f87171', width: 3 }, itemStyle: { color: '#f87171' }, label: { show: true, color: '#fca5a5', fontSize: 10, formatter: p => p.value + '%' }, tooltip: { valueFormatter: v => v + '%' } }] });
    const bar2 = (id, rows, colors) => chart(id, { tooltip: tip({ formatter: ps => { const x = rows[ps[0].dataIndex]; return `${x.k}<br>Saldo: <b>${money0(x.saldo)}</b> (${pct(x.pct)})<br>${x.n} préstamos · PAR30 ${pct(x.par30Pct)}`; } }), grid: { left: 10, right: 60, top: 10, bottom: 10, containLabel: true }, xAxis: { type: 'value', axisLabel: { show: false }, splitLine: axisStyle.splitLine }, yAxis: { type: 'category', inverse: true, data: rows.map(x => x.k), axisLabel: { color: '#cbd5f5', fontSize: 11 } },
      series: [{ type: 'bar', barWidth: 16, data: rows.map((x, i) => ({ value: x.saldo, itemStyle: { color: grad(colors[i % colors.length], shade(colors[i % colors.length], -.5), true), borderRadius: [0, 8, 8, 0], shadowBlur: 10, shadowColor: 'rgba(0,0,0,.4)' } })), label: { show: true, position: 'right', color: '#e8eeff', fontSize: 10.5, formatter: p => short(p.value) } }] });
    bar2('aMat', d.byMaturity, ['#f87171', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#818cf8']);
    bar2('aLp', d.byLastPay, ['#34d399', '#a3e635', '#fbbf24', '#fb923c', '#f87171', '#e11d48', '#94a3b8']);
    bar2('aRate', d.byRate, ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#94a3b8']);
    const cp = d.comp; const RUB = [['capital', 'Capital', '#38bdf8'], ['interes', 'Intereses', '#818cf8'], ['segVida', 'Seguro vida', '#f472b6'], ['feci', 'FECI', '#22d3ee'], ['manejo', 'Manejo', '#fbbf24']];
    chart('aComp', { tooltip: tip({ valueFormatter: v => money0(v) }), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 14, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: cp.map(x => x.k) }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine },
      series: RUB.map((r, i) => ({ name: r[1], type: 'bar', stack: 'c', data: cp.map(x => x[r[0]]), itemStyle: { color: r[2], borderRadius: i === RUB.length - 1 ? [6, 6, 0, 0] : 0 }, barWidth: '50%' })) });
    chart('aRefi', { tooltip: { trigger: 'item', formatter: p => `${p.name}<br><b>${money0(p.value)}</b> · ${p.percent}%` }, series: [{ type: 'pie', radius: ['48%', '75%'], itemStyle: { borderRadius: 10, borderColor: '#0b1226', borderWidth: 3 }, label: { color: '#e8eeff', formatter: p => `${p.name}\n${short(p.value)} · PAR30 ${pct(d.byRefi[p.dataIndex].par30Pct, 0)}` }, data: d.byRefi.map((x, i) => ({ name: x.k, value: x.saldo, itemStyle: { color: ['#38bdf8', '#fbbf24'][i] } })) }] });
    const ins = [];
    ins.push({ t: d.top25Pct > .5 ? 'bad' : d.top25Pct > .3 ? 'warn' : 'good', x: `Los 25 mayores clientes concentran ${pct(d.top25Pct)} de la cartera y los 10 mayores ${pct(d.top10Pct)}.` });
    const vOld = vin.filter(x => x.k < String(+a.month.slice(0, 4) - 3)); const vNew = vin.filter(x => x.k >= String(+a.month.slice(0, 4) - 3));
    const pr = arr => { const s = arr.reduce((t, x) => t + x.saldo, 0); return s ? arr.reduce((t, x) => t + x.par30, 0) / s : 0; };
    if (vOld.length && vNew.length) ins.push({ t: pr(vNew) > .1 ? 'warn' : 'good', x: `Los préstamos desembolsados en los últimos 3 años tienen PAR30 de ${pct(pr(vNew))}; los más antiguos, ${pct(pr(vOld))}.` });
    const old = d.byLastPay.filter(x => /años|Nunca/.test(x.k)); const os = old.reduce((s, x) => s + x.saldo, 0);
    if (os) ins.push({ t: 'bad', x: `${int(old.reduce((s, x) => s + x.n, 0))} préstamos no registran pagos hace más de un año (${short(os)}, ${pct(os / (k.cartera || 1))} de la cartera). Son candidatos a castigo o cobro judicial.` });
    const venc = d.byMaturity[0]; if (venc && venc.n) ins.push({ t: 'warn', x: `${int(venc.n)} préstamos ya pasaron su fecha final con ${short(venc.saldo)} de saldo.` });
    const rf = d.byRefi.find(x => x.k === 'Refinanciado'), og = d.byRefi.find(x => x.k === 'Original'); if (rf && og) ins.push({ t: rf.par30Pct > og.par30Pct ? 'warn' : 'good', x: `Los refinanciados tienen PAR30 de ${pct(rf.par30Pct)} frente a ${pct(og.par30Pct)} de los originales.` });
    const cap = d.comp.reduce((s, c) => s + c.capital, 0), oth = d.comp.reduce((s, c) => s + c.interes + c.manejo + c.feci + c.segVida, 0); ins.push({ t: 'warn', x: `Del saldo total, ${short(cap)} es capital y ${short(oth)} son intereses, manejo, FECI y seguro por cobrar.` });
    $('#anaIns').innerHTML = ins.map(i => `<li class="${i.t}"><i></i><span>${esc(i.x)}</span></li>`).join('');
  }


  // ---------- CUADRE ----------
  function renderCuadre() {
    const v = $('#v-cuadre'); const a = agg(); if (!a) { v.innerHTML = emptyCTA(); return; }
    const md = model();
    if (md && !reports().length && puedeTraerOriginales(S.current)) {
      v.innerHTML = `<div class="vhead"><div><h2>Cuadre con los reportes</h2><p>Compara cada número del dashboard contra los totales que trae cada reporte del SIF.</p></div></div><div class="card"><div class="muted">Trayendo los reportes originales de ${esc(a.label)} desde Google Sheets…</div></div>`;
      ensureOriginals(S.current, () => { if (S.tab === 'cuadre') renderCuadre(); }); return;
    }
    if (!md || !reports().length) { v.innerHTML = `<div class="vhead"><div><h2>Cuadre con los reportes</h2><p>Compara cada número del dashboard contra los totales que trae cada reporte del SIF.</p></div></div>${a.cuadre ? `<div class="grid g-kpi">${kpiCard('Último cuadre', a.cuadre.ok + ' de ' + a.cuadre.total, 'comparaciones exactas', '#34d399')}</div>` : ''}<div class="card mt">${needDetail(md ? 'Este mes viene de Google Sheets: tiene el detalle, pero no los reportes originales que se necesitan para el cuadre completo.' : 'El cuadre necesita los reportes originales.')}</div>`; return; }
    const res = C.reconcile(reports().filter(r => r.key), md, a);
    const ok = res.filter(r => r.ok).length, bad = res.length - ok, expl = res.filter(r => !r.ok && r.nota).length;
    v.innerHTML = `
      <div class="vhead"><div><h2>Cuadre con los reportes · ${esc(a.label)}</h2><p>Cada fila compara un número contra el total que trae el reporte del SIF. Así sabes que el dashboard leyó todo y que los reportes cuadran entre sí.</p></div></div>
      <div class="grid g-kpi">
        ${kpiCard('Comparaciones', int(res.length), int(reports().filter(r => r.key).length) + ' reportes revisados', '#38bdf8')}
        ${kpiCard('Cuadran exacto', int(ok), pct(ok / (res.length || 1), 1) + ' · tolerancia 5 centavos', '#34d399')}
        ${kpiCard('Diferencias explicadas', int(expl), 'por fecha de impresión', '#fbbf24')}
        ${kpiCard('Diferencias sin explicar', int(bad - expl), bad - expl ? 'revisa abajo' : 'todo cuadra', bad - expl ? '#f87171' : '#34d399')}
      </div>
      <div class="card mt"><h3>Detalle del cuadre</h3><div id="cuTbl"></div></div>`;
    enableTilt(v);
    const opts = `<select class="sel" id="fCu"><option value="">Todas</option><option value="no">Solo diferencias</option>${[...new Set(res.map(r => r.grupo))].map(g => `<option value="g:${esc(g)}">${esc(g)}</option>`).join('')}</select>`;
    const tb = table($('#cuTbl'), [
      { h: 'Estado', v: r => r.ok ? 0 : r.nota ? 1 : 2, f: (s) => `<span class="badge ${s === 0 ? 'b0' : s === 1 ? 'b2' : 'b4'}">${s === 0 ? 'Cuadra' : s === 1 ? 'Explicada' : 'Diferencia'}</span>` },
      { h: 'Tipo', v: r => r.grupo }, { h: 'Reporte', v: r => r.reporte }, { h: 'Concepto', v: r => r.concepto },
      { h: 'Dashboard / detalle', v: r => r.a, n: 1, f: x => nf2.format(x) }, { h: 'Total del reporte', v: r => r.b, n: 1, f: x => nf2.format(x) },
      { h: 'Diferencia', v: r => r.diff, n: 1, f: x => `<span style="color:${Math.abs(x) <= .05 ? '#34d399' : '#fbbf24'}">${nf2.format(x)}</span>` }, { h: 'Nota', v: r => r.nota }
    ], res, { sort: 0, dir: -1, pageSize: 60, toolsHtml: opts });
    $('#fCu').onchange = e => { const f = e.target.value; tb.setFilter(!f ? null : f === 'no' ? (r => !r.ok) : (r => r.grupo === f.slice(2))); };
  }

  // ---------- META DE COBROS ----------
  function renderMeta() {
    const v = $('#v-meta'); const a = agg(); if (!a) { v.innerHTML = emptyCTA(); return; }
    const p = prevAgg(); const md = model(); const cfg = S.config.meta;
    const base = p || a; const mf = C.metaFromAgg(base, cfg, p ? 'sig' : 'mes'); const next = C.metaFromAgg(a, cfg, 'sig');
    const real = a.kpi.recaudo; const cumpl = mf.meta ? real / mf.meta : 0;
    const thr = [30, 60, 90, 120, 365, 1e9]; const thrLb = v => v >= 1e8 ? 'todos (sin límite)' : v + ' días';
    v.innerHTML = `
      <div class="vhead"><div><h2>Meta de cobros</h2><p>La meta del mes es la suma de las letras que le tocan a cada cliente ese mes (quincenal: días 15 y fin de mes; mensual: un pago), como tu reporte de letras. Si quieres, súmale un % de recuperación de lo vencido por tramo.</p></div>
        <div class="tools" style="margin:0"><button class="btn pri" id="metaXls"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>Excel de meta de cobros (con letras)</button></div></div>
      <div class="grid g12">
        <div class="card ctrl" id="metaCtrl">
          <h3>Supuestos de la meta</h3>
          <div class="slider"><label>Contar letras de préstamos con mora hasta</label><output id="oThr">${thrLb(cfg.cuotaHastaDias)}</output><input type="range" id="sThr" min="0" max="5" step="1" value="${Math.max(0, thr.indexOf(cfg.cuotaHastaDias))}"></div>
          <div class="slider"><label>Efectividad esperada en letras</label><output id="oEf">${cfg.efectividadCuotas}%</output><input type="range" id="sEf" min="50" max="100" step="1" value="${cfg.efectividadCuotas}"></div>
          ${C.BUCKETS.slice(1).map((b, i) => `<div class="slider"><label>Extra: recuperar del vencido ${b} días</label><output id="oR${i + 1}">${cfg.recupera[i + 1]}%</output><input type="range" data-b="${i + 1}" class="sR" min="0" max="${i + 1 >= 4 ? 20 : 100}" step="${i + 1 >= 5 ? 0.25 : 1}" value="${cfg.recupera[i + 1]}"></div>`).join('')}
          <button class="btn sm ghost" id="metaReset">Volver al método del reporte de letras</button>
          <div class="note">Se guarda para los próximos meses. ${p ? `El cumplimiento de ${esc(a.label)} se mide contra la meta calculada con el cierre de ${esc(p.label)}.` : `Como no hay mes anterior, la meta de ${esc(a.label)} se estima con este mismo cierre.`}</div>
        </div>
        <div class="grid" style="gap:14px">
          <div class="grid g-kpi">
            ${kpiCard('Meta ' + esc(a.label), short(mf.meta), `Letras ${short(mf.metaCuotas)}${mf.metaRecup ? ' · Recup. ' + short(mf.metaRecup) : ''}`, '#818cf8')}
            ${kpiCard('Cobrado', short(real), `${int(a.kpi.recibos)} recibos · ${int(a.kpi.clientesPagaron)} clientes`, '#34d399')}
            ${kpiCard('Cumplimiento', pct(cumpl, 0), real >= mf.meta ? '<span class="chip up">Meta cumplida</span>' : `<span class="chip down">Faltaron ${short(mf.meta - real)}</span>`, cumpl >= 1 ? '#34d399' : '#f87171')}
            ${kpiCard('Meta ' + esc(C.monthLabel(C.nextMonth(a.month))), short(next.meta), 'con este cierre y tus supuestos', '#38bdf8')}
          </div>
          <div class="grid g2">
            <div class="card"><h3>Cumplimiento</h3><div id="gMeta" class="chart short"></div></div>
            <div class="card"><h3>Avance del cobro en el mes</h3><div id="cPace" class="chart short"></div></div>
          </div>
        </div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Meta vs cobrado por tramo</h3><div id="cMetaB" class="chart"></div></div>
        <div class="card"><h3>Meta vs cobrado por oficial</h3><div id="cMetaO" class="chart">${md ? '' : ''}</div></div>
      </div>
      <div class="card mt"><h3>Detalle por tramo</h3><div id="metaTbl"></div></div>
      <div class="card mt"><h3>Letras del mes por cliente <small>la letra que le corresponde a cada cliente</small></h3>
        ${md ? `<div class="tools"><div class="seg" id="letSeg"><button data-m="mes" class="${S.letMes !== 'sig' ? 'on' : ''}">${esc(C.monthLabel(md.month))} (vs cobrado)</button><button data-m="sig" class="${S.letMes === 'sig' ? 'on' : ''}">${esc(C.monthLabel(C.nextMonth(md.month)))} (por cobrar)</button></div><button class="btn sm pri" id="letXls">Excel de letras ${esc(C.monthLabel(S.letMes === 'sig' ? C.nextMonth(md.month) : md.month))}</button><button class="btn sm pri" id="letPpt">PowerPoint de letras</button></div>
        <div class="note" style="margin:-2px 0 10px">${S.letMes === 'sig' ? 'Letras que vencen en el mes siguiente, según la letra y la forma de pago de cada préstamo.' : 'Cómo se calcula el estado: <b>Vencieron en el mes</b> = la letra × las fechas de pago que caen en el mes (quincenal: 15 y fin de mes; mensual: una). <b>Cobrado</b> = todo lo que pagó ese contrato en el mes según el Informe Recaudado. <b>Pagó</b> si lo cobrado alcanza las letras del mes, <b>Parcial</b> si pagó algo pero menos, <b>No pagó</b> si no aparece ningún pago en el mes.'}</div>` : ''}
        <div id="letTbl">${md ? '' : needDetail('El listado de letras por cliente se arma con los reportes del mes.')}</div></div>
      <div class="card mt"><h3>Lista de cobro <small>quién debía pagar y cuánto falta</small></h3><div id="cobroTbl">${md ? '' : needDetail('La lista de cobro por cliente usa los reportes del mes.')}</div></div>`;
    enableTilt(v);
    $('#metaXls').onclick = downloadMeta;
    const upd = () => { saveConfig(); renderStamp++; Object.keys(rendered).forEach(k => rendered[k] = null); rendered.meta = S.current + '|' + renderStamp; renderMeta(); };
    $('#sThr').oninput = e => { cfg.cuotaHastaDias = thr[+e.target.value]; $('#oThr').textContent = thrLb(cfg.cuotaHastaDias); };
    $('#sThr').onchange = upd;
    $('#sEf').oninput = e => { cfg.efectividadCuotas = +e.target.value; $('#oEf').textContent = cfg.efectividadCuotas + '%'; };
    $('#sEf').onchange = upd;
    $$('.sR').forEach(s => { s.oninput = e => { const b = +s.dataset.b; cfg.recupera[b] = +e.target.value; $('#oR' + b).textContent = cfg.recupera[b] + '%'; }; s.onchange = upd; });
    $('#metaReset').onclick = () => { S.config.meta = JSON.parse(JSON.stringify(C.DEFAULT_CONFIG.meta)); upd(); };
    chart('gMeta', { series: [{ type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 150, radius: '92%', center: ['50%', '58%'], progress: { show: true, width: 16, roundCap: true, itemStyle: { color: grad(cumpl >= 1 ? '#34d399' : '#fbbf24', '#6366f1', true), shadowBlur: 14, shadowColor: 'rgba(56,189,248,.5)' } }, axisLine: { roundCap: true, lineStyle: { width: 16, color: [[1, 'rgba(140,170,255,.12)']] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false }, title: { offsetCenter: [0, '30%'], color: '#9fb0d8', fontSize: 12 }, detail: { valueAnimation: true, offsetCenter: [0, '-5%'], fontSize: 32, fontFamily: 'Space Grotesk', fontWeight: 700, color: '#e8eeff', formatter: v => v.toFixed(0) + '%' }, data: [{ value: +(cumpl * 100).toFixed(1), name: `${short(real)} de ${short(mf.meta)}` }] }] });
    const rd = a.recaudoDiario || []; let acc = 0; const accs = rd.map(x => (acc += x.v));
    const days = rd.map(x => x.d.slice(8, 10) + '/' + x.d.slice(5, 7));
    chart('cPace', { tooltip: tip({ axisPointer: { type: 'line' }, valueFormatter: v => money0(v) }), grid: { left: 54, right: 12, top: 20, bottom: 26 }, xAxis: Object.assign({ type: 'category', data: days, boundaryGap: false }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine },
      series: [{ name: 'Acumulado', type: 'line', smooth: true, data: accs, showSymbol: false, lineStyle: { width: 3, color: '#38bdf8' }, areaStyle: { color: grad('rgba(56,189,248,.45)', 'rgba(56,189,248,0)') }, markLine: { symbol: 'none', label: { color: '#fbbf24', formatter: 'Meta ' + short(mf.meta), position: 'insideEndTop' }, lineStyle: { color: '#fbbf24', type: 'dashed', width: 2 }, data: [{ yAxis: mf.meta }] } }, { name: 'Del día', type: 'bar', data: rd.map(x => x.v), itemStyle: { color: 'rgba(129,140,248,.6)', borderRadius: [4, 4, 0, 0] }, barWidth: '50%' }] });
    const mr = mf.rows;
    const realB = (a.metaRows || []).map(r => r.real || 0);
    chart('cMetaB', { tooltip: tip({ valueFormatter: v => money0(v) }), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 14, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: C.BUCKETS }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine },
      series: [{ name: 'Meta letras', type: 'bar', stack: 'm', data: mr.map(r => r.metaCuotas), itemStyle: { color: '#6366f1' }, barWidth: 22 }, { name: 'Meta recuperación', type: 'bar', stack: 'm', data: mr.map(r => r.metaRecup), itemStyle: { color: '#a78bfa', borderRadius: [6, 6, 0, 0] } }, { name: 'Cobrado', type: 'bar', data: realB, itemStyle: { color: grad('#34d399', '#065f46'), borderRadius: [6, 6, 0, 0] }, barWidth: 22 }] });
    if (md) {
      const per = C.computeMeta(md.loans, cfg, 'mes').perLoan;
      const om = new Map(); md.loans.forEach(l => { const g = om.get(l.oficial) || { k: l.oficial, meta: 0, real: 0 }; g.meta += per.get(l.id) || 0; g.real += l.pagadoMes; om.set(l.oficial, g); });
      const ofs = [...om.values()].sort((x, y) => y.meta - x.meta);
      chart('cMetaO', { tooltip: tip({ valueFormatter: v => money0(v) }), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 14, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: ofs.map(o => o.k) }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine },
        series: [{ name: 'Meta', type: 'bar', data: ofs.map(o => Math.round(o.meta)), itemStyle: { color: grad('#818cf8', '#312e81'), borderRadius: [6, 6, 0, 0] }, barWidth: 24 }, { name: 'Cobrado', type: 'bar', data: ofs.map(o => Math.round(o.real)), itemStyle: { color: grad('#34d399', '#065f46'), borderRadius: [6, 6, 0, 0] }, barWidth: 24, label: { show: true, position: 'top', color: '#e8eeff', fontSize: 10.5, formatter: p => { const o = ofs[p.dataIndex]; return o.meta ? pct(o.real / o.meta, 0) : ''; } } }] });
      const sig = S.letMes === 'sig';
      const sucs = [...new Set(md.loans.map(l => String(l.sucursal).replace(/^\d+\s+/, '')))].sort();
      const letRows = md.loans.map(l => ({ l, lt: sig ? (l.letrasSig || 0) : (l.letrasMes || 0), suc: String(l.sucursal).replace(/^\d+\s+/, '') }));
      const letCols = [
        { h: 'Contrato', v: x => x.l.id }, { h: 'Cliente', v: x => x.l.nombre }, { h: 'Sucursal', v: x => x.suc },
        { h: 'Letra', v: x => x.l.letra, n: 1, f: money }, { h: 'Forma pago', v: x => C.freqName(x.l.freq) },
        { h: sig ? 'Vencen en el mes' : 'Vencieron en el mes', v: x => x.lt, n: 1, f: money, sum: 1 }];
      if (!sig) letCols.push({ h: 'Cobrado', v: x => x.l.pagadoMes, n: 1, f: money, sum: 1 }, { h: 'Falta', v: x => Math.max(0, x.lt - x.l.pagadoMes), n: 1, f: money, sum: 1 }, { h: 'Estado', v: x => x.lt <= 0 ? (x.l.pagadoMes > 0 ? 'Abonó' : '—') : x.l.pagadoMes <= 0 ? 'No pagó' : x.l.pagadoMes + 0.01 < x.lt ? 'Parcial' : 'Pagó', f: s => `<span class="badge ${s === 'Pagó' || s === 'Abonó' ? 'b0' : s === 'Parcial' ? 'b2' : s === 'No pagó' ? 'b4' : ''}">${s}</span>` });
      letCols.push({ h: 'Días mora', v: x => x.l.dias, n: 1, f: int }, { h: 'Saldo', v: x => x.l.saldo, n: 1, f: money, sum: 1 }, { h: 'Saldo al día', v: x => x.l.corriente, n: 1, f: money, sum: 1 }, { h: 'Mora', v: x => x.l.totalMoroso, n: 1, f: money, sum: 1 },
        { h: 'Primera letra', v: x => x.l.fini || '', f: dd }, { h: 'Última letra', v: x => x.l.fvenc || '', f: dd }, { h: 'Cédula', v: x => x.l.cedula });
      const letOpts = `<select class="sel" id="fSuc"><option value="">Todas las sucursales</option>${sucs.map(s => `<option>${esc(s)}</option>`).join('')}</select><select class="sel" id="fLet"><option value="con">Con letra en el mes</option><option value="">Todos los préstamos</option>${sig ? '' : '<option value="no">No pagaron</option>'}</select>`;
      const lt = table($('#letTbl'), letCols, letRows, { sort: 5, total: true, toolsHtml: letOpts });
      const applyLet = () => { const s = $('#fSuc').value, f = $('#fLet').value; lt.setFilter(x => (!s || x.suc === s) && (f === '' || (f === 'con' ? x.lt > 0 : x.lt > 0 && x.l.pagadoMes <= 0))); };
      $('#fSuc').onchange = applyLet; $('#fLet').onchange = applyLet; applyLet();
      $$('#letSeg button').forEach(b => b.onclick = () => { S.letMes = b.dataset.m; renderStamp++; rendered.meta = null; renderMeta(); rendered.meta = S.current + '|' + renderStamp; setTimeout(() => { const el = $('#letTbl'); el && el.scrollIntoView({ block: 'start' }); }, 50); });
      $('#letXls').onclick = () => downloadLetras(sig ? C.nextMonth(md.month) : md.month);
      $('#letPpt').onclick = () => downloadLetrasPPT(sig ? 'sig' : 'mes');
      const rows = md.loans.map(l => ({ l, meta: per.get(l.id) || 0 })).filter(x => x.meta > 0.005 || x.l.pagadoMes > 0);
      const opts = '<select class="sel" id="fPago"><option value="">Todos</option><option value="no">No pagaron en el mes</option><option value="parcial">Pagaron menos de la meta</option><option value="ok">Cumplieron</option></select>';
      const tb = table($('#cobroTbl'), [
        { h: 'Contrato', v: x => x.l.id }, { h: 'Cliente', v: x => x.l.nombre }, { h: 'Patrono', v: x => x.l.patrono }, { h: 'Oficial', v: x => x.l.oficial },
        { h: 'Tramo', v: x => x.l.bucket, f: b => `<span class="badge b${b}">${C.BUCKETS[b]}</span>` }, { h: 'Cuota mes', v: x => x.l.cuotaMes, n: 1, f: money },
        { h: 'Meta', v: x => x.meta, n: 1, f: money, sum: 1 }, { h: 'Cobrado', v: x => x.l.pagadoMes, n: 1, f: money, sum: 1 }, { h: 'Falta', v: x => Math.max(0, x.meta - x.l.pagadoMes), n: 1, f: money, sum: 1 },
        { h: 'Estado', v: x => x.l.pagadoMes <= 0 ? 'No pagó' : x.l.pagadoMes + 0.01 < x.meta ? 'Parcial' : 'Cumplió', f: s => `<span class="badge ${s === 'Cumplió' ? 'b0' : s === 'Parcial' ? 'b2' : 'b4'}">${s}</span>` }
      ], rows, { sort: 8, total: true, toolsHtml: opts });
      $('#fPago').onchange = e => { const f = e.target.value; tb.setFilter(!f ? null : f === 'no' ? (x => x.l.pagadoMes <= 0) : f === 'parcial' ? (x => x.l.pagadoMes > 0 && x.l.pagadoMes + 0.01 < x.meta) : (x => x.l.pagadoMes + 0.01 >= x.meta)); };
    } else {
      $('#cMetaO').innerHTML = needDetail('Meta por oficial usa el detalle del mes.');
    }
    const inCart = (a.metaRows || []).reduce((s, r) => s + (r.real || 0), 0); const fuera = Math.max(0, real - inCart);
    const mrRows = fuera > 0.5 ? mr.concat([{ k: 'Fuera de la cartera activa', n: 0, moroso: 0, metaCuotas: 0, metaRecup: 0, meta: 0, _real: fuera }]) : mr;
    table($('#metaTbl'), [
      { h: 'Tramo', v: r => r.k, f: (k) => C.BUCKETS.indexOf(k) < 0 ? `<span class="muted">${k}</span>` : `<span class="badge b${C.BUCKETS.indexOf(k)}">${k}</span>` }, { h: '# Préstamos', v: r => r.n, n: 1, sum: 1, f: int },
      { h: 'Saldo moroso', v: r => r.moroso, n: 1, f: money, sum: 1 }, { h: 'Meta letras', v: r => r.metaCuotas, n: 1, f: money, sum: 1 }, { h: 'Meta recuperación', v: r => r.metaRecup, n: 1, f: money, sum: 1 },
      { h: 'Meta total', v: r => r.meta, n: 1, f: money, sum: 1 }, { h: 'Cobrado ' + a.label, v: r => r._real != null ? r._real : ((a.metaRows[C.BUCKETS.indexOf(r.k)] || {}).real || 0), n: 1, f: money, sum: 1 }
    ], mrRows, { search: false, sort: -1, total: true, pageSize: 10 });
    if (fuera > 0.5) $('#metaTbl').insertAdjacentHTML('beforeend', `<div class="note">La fila "Fuera de la cartera activa" son pagos de préstamos que ya no están en el cierre (cancelados en el mes). Cuentan en el cobrado total, pero no tienen meta.</div>`);
  }

  // ---------- INGRESOS ----------
  function renderIngresos() {
    const v = $('#v-ingresos'); const a = agg(); if (!a) { v.innerHTML = emptyCTA(); return; }
    const k = a.kpi, md = model(), p = prevAgg(), pk = p && p.kpi;
    v.innerHTML = `
      <div class="vhead"><div><h2>Ingresos y operaciones del mes</h2><p>Intereses y gastos de manejo devengados, FECI, seguro de vida, cancelaciones y vencimientos.</p></div></div>
      <div class="grid g-kpi">
        ${kpiCard('Intereses devengados', short(k.interesesMes), delta(k.interesesMes, pk && pk.interesesMes), '#818cf8')}
        ${kpiCard('Gastos de manejo', short(k.gmMes), delta(k.gmMes, pk && pk.gmMes), '#a78bfa')}
        ${kpiCard('FECI del mes', short(k.feciMes), 'Pagos FECI ' + short(k.feciPagosMes), '#22d3ee')}
        ${kpiCard('Prima seguro de vida', short(k.segPrima), `${int(k.segAsegurados)} asegurados · ITBMS ${short(k.segPrima * .05)}`, '#f472b6')}
        ${kpiCard('Cancelados', int(k.canceladosN), short(k.canceladosMonto) + ' cancelado', '#34d399')}
        ${kpiCard('Vencidos con saldo', int(k.vencidosRepN || k.vencidosN), short(k.vencidosRepSaldo || k.vencidosSaldo), '#f87171')}
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Intereses y GM por producto</h3><div id="iProd" class="chart tall"></div></div>
        <div class="card"><h3>Cómo se aplicaron los pagos</h3><div id="iPagos" class="chart tall"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>Saldos por rubro de la cartera</h3><div id="iRub" class="chart"></div></div>
        <div class="card"><h3>Recaudo por forma de pago</h3><div id="iForma" class="chart"></div></div>
      </div>
      ${a.deep && a.deep.seguro ? `
      <div class="grid g-kpi mt">
        ${kpiCard('Asegurados', int(k.segAsegurados), 'saldo asegurado ' + short(a.deep.seguro.saldoAsegurado), '#f472b6')}
        ${kpiCard(a.deep.seguro.sinSeguroSonVencidos ? 'Fuera del informe de seguro' : 'Préstamos sin seguro', int(a.deep.seguro.sinSeguroN), a.deep.seguro.sinSeguroSonVencidos ? 'son los préstamos vencidos: ya no se les cobra seguro' : short(a.deep.seguro.sinSeguroSaldo) + ' de saldo', '#fb7185')}
        ${kpiCard('Seguro a pagar', short(k.segPrima * 1.05), 'prima ' + short(k.segPrima) + ' + ITBMS 5%', '#a78bfa')}
        ${kpiCard('Saldo FECI', short(k.feciSaldo), int(a.deep.feci.prestamos) + ' préstamos con FECI', '#22d3ee')}
        ${kpiCard('FECI devengado', short(a.deep.feci.devengado), 'de ' + short(a.deep.feci.feciTotal) + ' generado', '#38bdf8')}
        ${kpiCard('Pagos de FECI del mes', short(k.feciPagosMes), 'FECI del mes ' + short(k.feciMes), '#34d399')}
      </div>
      <div class="grid g3 mt">
        <div class="card"><h3>Seguro de vida por edad <small>prima y asegurados</small></h3><div id="iSegAge" class="chart"></div></div>
        <div class="card"><h3>Seguro por aseguradora y sexo</h3><div id="iSegSex" class="chart"></div></div>
        <div class="card"><h3>Saldo de seguro por tramo de mora</h3><div id="iSegB" class="chart"></div></div>
      </div>
      <div class="grid g2 mt">
        <div class="card"><h3>FECI: saldo por tramo de mora</h3><div id="iFeciB" class="chart"></div></div>
        <div class="card"><h3>Préstamos vencidos por antigüedad</h3><div id="iVencAge" class="chart"></div></div>
      </div>` : ''}
      <div class="grid g2 mt">
        <div class="card"><h3>Préstamos cancelados en el mes</h3><div id="iCanc">${md ? '' : needDetail()}</div></div>
        <div class="card"><h3>Préstamos que vencen en el periodo</h3><div id="iVenc">${md ? '' : needDetail()}</div></div>
      </div>`;
    enableTilt(v);
    const ip = (a.interesesProducto || []).slice().sort((x, y) => (y.int + y.gm) - (x.int + x.gm));
    chart('iProd', { tooltip: tip({ valueFormatter: v => money(v) }), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 10, right: 30, top: 34, bottom: 10, containLabel: true }, xAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, yAxis: { type: 'category', inverse: true, data: ip.map(x => shortName(x.k)), axisLabel: { color: '#cbd5f5', fontSize: 10.5 } },
      series: [{ name: 'Intereses', type: 'bar', stack: 'i', data: ip.map(x => x.int), itemStyle: { color: grad('#818cf8', '#3730a3', true) }, barWidth: 16 }, { name: 'Gastos de manejo', type: 'bar', stack: 'i', data: ip.map(x => x.gm), itemStyle: { color: grad('#f472b6', '#9d174d', true), borderRadius: [0, 6, 6, 0] } }] });
    const pg = [['Capital y cuotas', k.pagosCapital], ['Devolución intereses', k.pagosDevInt], ['Devolución seguro vida', k.pagosDevSeg], ['Devolución pago en exceso', k.pagosDevExceso], ['Devolución FECI', k.pagosDevFeci], ['Ingresos varios', k.pagosIngVarios]].filter(x => x[1] > 0);
    chart('iPagos', { tooltip: { trigger: 'item', formatter: p => `${p.name}<br><b>${money(p.value)}</b> · ${p.percent}%` }, legend: { bottom: 0, textStyle: { color: '#9fb0d8', fontSize: 11 } }, series: [{ type: 'pie', radius: ['45%', '72%'], center: ['50%', '44%'], itemStyle: { borderRadius: 10, borderColor: '#0b1226', borderWidth: 3, shadowBlur: 20, shadowColor: 'rgba(0,0,0,.6)' }, label: { color: '#cbd5f5', formatter: p => p.percent > 3 ? short(p.value) : '' }, data: pg.map((x, i) => ({ name: x[0], value: x[1], itemStyle: { color: PAL[i] } })) }] });
    const rub = [['Capital', k.rubCapital], ['Intereses', k.rubInteres], ['Seguro vida', k.rubSegVida], ['FECI', k.rubFeci], ['Manejo', k.rubManejo]];
    chart('iRub', { tooltip: tip({ valueFormatter: v => money0(v) }), grid: { left: 60, right: 14, top: 30, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: rub.map(r => r[0]) }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, series: cylinder(rub.map(r => r[0]), rub.map(r => r[1]), PAL, { w: 34, label: v => short(v) }) });
    chart('iForma', { tooltip: { trigger: 'item', formatter: p => `${p.name}<br><b>${money(p.value)}</b> · ${p.percent}%` }, series: [{ type: 'pie', radius: ['50%', '75%'], center: ['50%', '52%'], startAngle: 200, itemStyle: { borderRadius: 12, borderColor: '#0b1226', borderWidth: 4 }, label: { color: '#e8eeff', formatter: p => `${p.name}\n${short(p.value)}` }, data: [{ name: 'Efectivo / depósito', value: k.recaudoEfectivo, itemStyle: { color: '#38bdf8' } }, { name: 'Cheque', value: k.recaudoCheque, itemStyle: { color: '#818cf8' } }] }] });
    const dp = a.deep;
    if (dp && dp.seguro) {
      const sa = dp.seguro.segAge;
      chart('iSegAge', { tooltip: tip(), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 50, right: 40, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: sa.map(x => x.k) }, axisStyle), yAxis: [{ type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => '$' + v }, splitLine: axisStyle.splitLine }, { type: 'value', axisLabel: { color: '#9fb0d8' }, splitLine: { show: false } }],
        series: [{ name: 'Prima', type: 'bar', barWidth: '50%', data: sa.map(x => x.prima), itemStyle: { color: grad('#f472b6', '#831843'), borderRadius: [6, 6, 0, 0] }, tooltip: { valueFormatter: v => money(v) } }, { name: 'Asegurados', type: 'line', yAxisIndex: 1, data: sa.map(x => x.n), symbolSize: 9, lineStyle: { color: '#e8eeff' }, itemStyle: { color: '#e8eeff' } }] });
      const ss = dp.seguro.segSex; const sg = Object.entries(a.segAseg || {});
      chart('iSegSex', { tooltip: { trigger: 'item', formatter: p => `${p.seriesName}<br>${p.name}: <b>${money(p.value)}</b> · ${p.percent}%` }, legend: { bottom: 0, textStyle: { color: '#9fb0d8', fontSize: 11 } },
        series: [{ name: 'Aseguradora', type: 'pie', radius: ['0%', '38%'], center: ['50%', '45%'], label: { show: false }, data: sg.map(([n, v], i) => ({ name: n.replace(/^\d+\s*/, ''), value: v, itemStyle: { color: ['#a78bfa', '#64748b', '#38bdf8'][i % 3] } })) }, { name: 'Sexo', type: 'pie', radius: ['50%', '70%'], center: ['50%', '45%'], itemStyle: { borderColor: '#0b1226', borderWidth: 3, borderRadius: 8 }, label: { color: '#e8eeff', formatter: p => `${p.name}
${p.percent}%` }, data: ss.map((x, i) => ({ name: x.k, value: x.prima, itemStyle: { color: ['#38bdf8', '#f472b6', '#94a3b8'][i] } })) }] });
      chart('iSegB', { tooltip: tip({ valueFormatter: v => money0(v) }), grid: { left: 54, right: 10, top: 20, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: C.BUCKETS }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, series: cylinder(C.BUCKETS, dp.seguro.segB.map(x => x.seg), BCOL, { w: 24, label: v => short(v) }) });
      chart('iFeciB', { tooltip: tip({ valueFormatter: v => money0(v) }), grid: { left: 54, right: 10, top: 20, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: C.BUCKETS }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine }, series: cylinder(C.BUCKETS, dp.feci.byBucket.map(x => x.feci), ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb7185'], { w: 28, label: v => short(v) }) });
      const va = dp.vencAge || [];
      chart('iVencAge', { tooltip: tip({ formatter: ps => { const x = va[ps[0].dataIndex]; return `${x.k}<br>${x.n} préstamos<br><b>${money0(x.saldo)}</b>`; } }), grid: { left: 10, right: 60, top: 10, bottom: 10, containLabel: true }, xAxis: { type: 'value', axisLabel: { show: false }, splitLine: axisStyle.splitLine }, yAxis: { type: 'category', inverse: true, data: va.map(x => x.k + ' vencido'), axisLabel: { color: '#cbd5f5' } }, series: [{ type: 'bar', barWidth: 18, data: va.map((x, i) => ({ value: x.saldo, itemStyle: { color: grad(['#fbbf24', '#fb923c', '#f87171', '#e11d48'][i], '#3b0d1d', true), borderRadius: [0, 8, 8, 0] } })), label: { show: true, position: 'right', color: '#e8eeff', formatter: p => short(p.value) + ' · ' + va[p.dataIndex].n } }] });
    }
    if (md) {
      table($('#iCanc'), [{ h: 'Contrato', v: x => x.id }, { h: 'Cliente', v: x => x.nombre }, { h: 'Fecha', v: x => x.fcancel, f: dd }, { h: 'Monto', v: x => x.monto, n: 1, f: money, sum: 1 }, { h: 'Intereses', v: x => x.intereses, n: 1, f: money, sum: 1 }, { h: 'GM', v: x => x.gm, n: 1, f: money, sum: 1 }], md.R.cancelados || [], { search: false, total: true, sort: 3 });
      table($('#iVenc'), [{ h: 'Contrato', v: x => x.id }, { h: 'Cliente', v: x => x.nombre }, { h: 'Vence', v: x => x.fvenc, f: dd }, { h: 'Saldo', v: x => x.saldo, n: 1, f: money, sum: 1 }, { h: 'Por cobrar', v: x => x.totalFact, n: 1, f: money, sum: 1 }, { h: 'Oficial', v: x => x.oficial }], md.R.aVencer || [], { search: false, total: true, sort: 3 });
    }
  }

  // ---------- EXCEL GSF ----------
  function renderExcel() {
    const v = $('#v-excel'); const a = agg(); const md = model();
    v.innerHTML = `
      <div class="vhead"><div><h2>Excel GSF · Cartera al cierre</h2><p>Arma el mismo archivo "GSF - Cartera Cierre" que haces a mano: morosidad al cierre (A–T) más saldos por rubro de la cartera agregada (U–AP), un préstamo por fila, ordenado por cliente.</p></div></div>
      ${md ? `
      <div class="grid g21">
        <div class="card"><h3>Vista previa <small>${int(md.loans.length)} préstamos · 42 columnas</small></h3><div id="gsfPrev"></div></div>
        <div class="card ctrl">
          <h3>Descargar</h3>
          <div class="note" style="margin:0">Hoja principal igual a tu Excel. Hojas adicionales:</div>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="gsfRes" checked> Resumen por clasificación y patrono</label>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="gsfMeta" checked> Meta de cobros (por tramo, oficial, patrono, lista de cobro y quién no pagó)</label>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="gsfTop" checked> 25 mayores clientes</label>
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="gsfAna" checked> Análisis (cosechas, vencimientos, tasas, último pago, composición)</label>
          <button class="btn pri" id="dlGsf"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>GSF - Cartera Cierre ${esc(fileMonth(md.month))}.xlsx</button>
          <button class="btn" id="dlAna">Análisis completo del mes (.xlsx)</button>
          <div class="note">El análisis completo trae hojas por tramo, producto, patrono, oficial, meta, lista de cobro, 25 mayores clientes, cosechas, vencimientos, tasas y último pago.</div>
          <h3 class="mt">Nombres de patrono <small>para la columna C</small></h3>
          <div class="note" style="margin-top:-4px">Si quieres que un patrono salga con otro nombre en la columna C, escríbelo aquí; se recuerda para los próximos meses.</div>
          <input class="inp" id="patQ" placeholder="Filtrar patronos…">
          <div class="patmap" id="patMap"></div>
        </div>
      </div>` : `<div class="card">${needDetail('El Excel GSF se arma con el detalle de los reportes del mes.')}</div>`}`;
    if (!md) return;
    const rows = C.gsfRows(md, S.config);
    const cols = C.GSF_HEAD.map((h, j) => ({ h: String(h), v: r => r[j], n: ['m', 'i', 'n'].includes(C.GSF_TYPES[j]), f: C.GSF_TYPES[j] === 'm' ? (x => x == null ? '' : nf2.format(x)) : C.GSF_TYPES[j] === 'd' ? dd : null }));
    table($('#gsfPrev'), cols, rows, { pageSize: 25, sort: -1 });
    $('#dlGsf').onclick = () => downloadGSF($('#gsfRes').checked, { meta: $('#gsfMeta').checked, top25: $('#gsfTop').checked, analisis: $('#gsfAna').checked });
    $('#dlAna').onclick = downloadAnalysis;
    const pats = [...new Set(md.loans.map(l => l.patrono).filter(x => x && x !== '—'))].sort();
    const drawMap = (q) => {
      $('#patMap').innerHTML = pats.filter(p => !q || p.toLowerCase().includes(q.toLowerCase())).map(p => `<div class="k" title="${esc(p)}">${esc(p)}</div><input class="inp" data-p="${esc(p)}" value="${esc(S.config.patronoMap[p] != null ? S.config.patronoMap[p] : p)}">`).join('');
      $$('#patMap input').forEach(i => i.onchange = () => { const k = i.dataset.p; if (i.value.trim() === k || !i.value.trim()) delete S.config.patronoMap[k]; else S.config.patronoMap[k] = i.value; saveConfig(); toast('Nombre guardado'); });
    };
    drawMap(''); $('#patQ').oninput = e => drawMap(e.target.value);
  }
  const fileMonth = ym => { const [y, m] = ym.split('-'); return `${lastDayNum(ym)} ${C.MESES[+m - 1]} ${y}`; };
  const lastDayNum = ym => C.lastDay(ym).slice(8);

  async function saveFile(filename, blob) {
    if (!puede('descargar')) { toast('Tu rol no permite descargar archivos.'); return; }
    if (!S.downloads) S.downloads = await capUse('downloads');
    if (S.downloads) {
      try { await S.downloads.save({ filename, data: blob }); toast('Listo: ' + filename); return; }
      catch (e) { if (e && e.code === 'declined') { toast('Descarga cancelada'); return; } if (e && e.code === 'rate_limited') { toast('Espera un momento y vuelve a intentar'); return; } toast('No se pudo descargar (' + (e && e.code || 'error') + ')'); return; }
    }
    if (!window.claude) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return; }
    toast('Las descargas no están disponibles en esta vista. Abre el dashboard en claude.ai.');
  }
  async function downloadGSF(resumen, sheets) {
    const md = model(); if (!md) return;
    loader(true, 'Armando el Excel GSF…', 30);
    try {
      await loadScript('exceljs');
      const cierre = reports().find(r => r.key === 'cierre');
      const wb = await Exporters.gsfWorkbook(md, S.config, { resumen, sheets: sheets || {}, agg: agg(), prevAgg: prevAgg(), cierreMeta: { printed: cierre && cierre.meta.printedRaw } });
      loader(true, 'Generando archivo…', 80);
      const buf = await wb.xlsx.writeBuffer();
      loader(false);
      await saveFile(`GSF - Cartera Cierre ${fileMonth(md.month)}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (e) { loader(false); console.error(e); toast('Error al generar el Excel: ' + e.message); }
  }
  async function downloadLetras(ym) {
    const md = model(); if (!md) return;
    loader(true, 'Armando el Excel de letras…', 30);
    try { await loadScript('exceljs'); const wb = await Exporters.letrasWorkbook(md, ym); const buf = await wb.xlsx.writeBuffer(); loader(false); await saveFile(`Letras de la cartera ${C.monthLabel(ym)}.xlsx`, new Blob([buf])); }
    catch (e) { loader(false); console.error(e); toast('Error: ' + e.message); }
  }
  function letrasEstado(md, mode) {
    const sig = mode === 'sig';
    const rows = md.loans.map(l => { const lt = sig ? (l.letrasSig || 0) : (l.letrasMes || 0); const falta = Math.max(0, lt - l.pagadoMes); const est = sig ? 'Por cobrar' : lt <= 0 ? (l.pagadoMes > 0 ? 'Abonó' : '—') : l.pagadoMes <= 0 ? 'No pagó' : l.pagadoMes + 0.01 < lt ? 'Parcial' : 'Pagó'; return { l, lt, falta, est, suc: String(l.sucursal).replace(/^\d+\s+/, '') }; }).filter(x => x.lt > 0);
    const by = (f) => { const m = new Map(); rows.forEach(x => { const k = f(x); const g = m.get(k) || { k, n: 0, lt: 0, cob: 0, falta: 0 }; g.n++; g.lt += x.lt; g.cob += Math.min(x.l.pagadoMes, x.lt); g.falta += x.falta; m.set(k, g); }); return [...m.values()]; };
    return { rows, porEstado: ['Pagó', 'Parcial', 'No pagó'].map(e => by(x => x.est).find(g => g.k === e) || { k: e, n: 0, lt: 0, cob: 0, falta: 0 }), porSuc: by(x => x.suc).sort((p, q) => q.lt - p.lt), total: rows.reduce((s, x) => s + x.lt, 0), cobrado: rows.reduce((s, x) => s + Math.min(x.l.pagadoMes, x.lt), 0) };
  }
  function addLetrasSlides(pptx, md, mode, title, NAVY, BLUE) {
    const sig = mode === 'sig'; const ym = sig ? C.nextMonth(md.month) : md.month; const E = letrasEstado(md, mode);
    const HD = o => ({ text: o, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } });
    let s = pptx.addSlide({ masterName: 'M' }); title(s, sig ? `Letras por cobrar · ${C.monthLabel(ym)}` : `Letras del mes · ${C.monthLabel(ym)}`, sig ? 'según la cartera al cierre' : 'vencieron vs cobrado');
    if (sig) {
      s.addText(money0(E.total), { x: 0.6, y: 1.4, w: 5, h: 1, fontSize: 44, bold: true, color: BLUE });
      s.addText(`en letras de ${E.rows.length} préstamos vencen en ${C.monthLabel(ym)}`, { x: 0.6, y: 2.4, w: 5.5, h: 0.6, fontSize: 15, color: '334155' });
    } else {
      s.addText(pct(E.total ? E.cobrado / E.total : 0, 0), { x: 0.6, y: 1.3, w: 4, h: 1.1, fontSize: 54, bold: true, color: E.cobrado >= E.total ? '16A34A' : 'D97706' });
      s.addText(`de las letras del mes cobradas\n${money0(E.cobrado)} de ${money0(E.total)}`, { x: 0.6, y: 2.4, w: 5.2, h: 0.9, fontSize: 15, color: '334155' });
      s.addChart(pptx.ChartType.doughnut, [{ name: 'Préstamos', labels: E.porEstado.map(g => g.k), values: E.porEstado.map(g => g.n) }], { x: 0.4, y: 3.4, w: 5.4, h: 3.3, holeSize: 55, chartColors: ['16A34A', 'F59E0B', 'DC2626'], showLegend: true, legendPos: 'r', showValue: true, showPercent: false, dataLabelColor: 'FFFFFF', legendFontSize: 13 });
    }
    s.addTable([[HD('Sucursal'), HD('Préstamos'), HD(sig ? 'Vencen' : 'Vencieron'), ...(sig ? [] : [HD('Cobrado'), HD('Falta'), HD('%')])], ...E.porSuc.map(g => [g.k, String(g.n), money0(g.lt), ...(sig ? [] : [money0(g.cob), money0(g.falta), pct(g.lt ? g.cob / g.lt : 0, 0)])]), [{ text: 'Total', options: { bold: true } }, { text: String(E.rows.length), options: { bold: true } }, { text: money0(E.total), options: { bold: true } }, ...(sig ? [] : [{ text: money0(E.cobrado), options: { bold: true } }, { text: money0(E.total - E.cobrado), options: { bold: true } }, { text: pct(E.total ? E.cobrado / E.total : 0, 0), options: { bold: true } }])]], { x: 6.2, y: 1.3, w: 6.7, fontSize: 12, rowH: 0.38, border: { type: 'solid', color: 'E2E8F0', pt: 1 } });
    if (!sig) s.addTable([[HD('Estado'), HD('Préstamos'), HD('Letras'), HD('Falta')], ...E.porEstado.map(g => [{ text: g.k, options: { bold: true, color: g.k === 'Pagó' ? '16A34A' : g.k === 'Parcial' ? 'D97706' : 'DC2626' } }, String(g.n), money0(g.lt), money0(g.falta)])], { x: 6.2, y: 5.0, w: 6.7, fontSize: 12, rowH: 0.36, border: { type: 'solid', color: 'E2E8F0', pt: 1 } });
    const list = E.rows.slice().sort((p, q) => sig ? q.lt - p.lt : q.falta - p.falta || q.lt - p.lt).filter(x => sig || x.falta > 0.005);
    const per = 14;
    for (let i = 0; i < list.length; i += per) {
      const part = list.slice(i, i + per);
      s = pptx.addSlide({ masterName: 'M' }); title(s, sig ? `Letras por cobrar · ${C.monthLabel(ym)}` : `Clientes que no completaron su letra · ${C.monthLabel(ym)}`, `${i + 1}–${i + part.length} de ${list.length}`);
      s.addTable([[HD('Contrato'), HD('Cliente'), HD('Sucursal'), HD('Letra'), HD('Forma'), HD(sig ? 'Vencen' : 'Vencieron'), ...(sig ? [HD('Días mora')] : [HD('Cobrado'), HD('Falta'), HD('Estado')])],
        ...part.map(x => [x.l.id, x.l.nombre, x.suc, money0(x.l.letra), C.freqName(x.l.freq), money0(x.lt), ...(sig ? [String(x.l.dias)] : [money0(x.l.pagadoMes), { text: money0(x.falta), options: { bold: true } }, { text: x.est, options: { bold: true, color: x.est === 'Parcial' ? 'D97706' : 'DC2626' } }])])],
        { x: 0.4, y: 1.15, w: 12.5, fontSize: 11, rowH: 0.36, border: { type: 'solid', color: 'E2E8F0', pt: 1 }, colW: sig ? [2.0, 4.0, 1.7, 1.1, 1.1, 1.3, 1.3] : [1.9, 3.5, 1.5, 1.0, 1.0, 1.1, 1.0, 1.0, 1.0] });
    }
  }
  function pptBase(titleText, a) {
    const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = titleText;
    const NAVY = '0F2A52', BLUE = '1D4ED8', GREY = '64748B';
    pptx.defineSlideMaster({ title: 'M', background: { color: 'FFFFFF' }, objects: [{ rect: { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: NAVY } } }, { text: { text: `Grupo de Servicios Financieros · Cierre ${a.label}`, options: { x: 0.5, y: 7.05, w: 8, h: 0.3, fontSize: 10, color: GREY } } }], slideNumber: { x: 12.4, y: 7.05, fontSize: 10, color: GREY } });
    const title = (s, t, sub) => { s.addText(t, { x: 0.5, y: 0.12, w: 9, h: 0.66, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: 'Calibri' }); if (sub) s.addText(sub, { x: 8.8, y: 0.12, w: 4, h: 0.66, fontSize: 12, color: 'C7D2FE', align: 'right' }); };
    return { pptx, NAVY, BLUE, title };
  }
  async function downloadLetrasPPT(mode) {
    const md = model(); const a = agg(); if (!md) return;
    loader(true, 'Armando la presentación de letras…', 30);
    try {
      await loadScript('pptx');
      const ym = mode === 'sig' ? C.nextMonth(md.month) : md.month;
      const { pptx, NAVY, BLUE, title } = pptBase('Letras de la cartera ' + C.monthLabel(ym), a);
      addLetrasSlides(pptx, md, mode, title, NAVY, BLUE);
      const blob = await pptx.write({ outputType: 'blob' }); loader(false);
      await saveFile(`Letras de la cartera ${C.monthLabel(ym)}.pptx`, blob);
    } catch (e) { loader(false); console.error(e); toast('Error: ' + e.message); }
  }
  async function downloadMeta() {
    const md = model(); const a = agg(); if (!a) return;
    loader(true, 'Armando el Excel de meta de cobros…', 30);
    try {
      await loadScript('exceljs');
      const wb = await Exporters.metaWorkbook(md, a, S.config, prevAgg());
      const buf = await wb.xlsx.writeBuffer(); loader(false);
      if (!md) toast('Sin los reportes del mes el Excel trae solo los totales por tramo.', 5000);
      await saveFile(`Meta de cobros ${a.label}.xlsx`, new Blob([buf]));
    } catch (e) { loader(false); console.error(e); toast('Error: ' + e.message); }
  }
  async function downloadAnalysis() {
    const md = model(); const a = agg(); if (!a) return;
    loader(true, 'Armando el análisis…', 30);
    try {
      await loadScript('exceljs');
      let cq = null; try { if (md) cq = C.reconcile(reports(), md, a); } catch (er) { }
      const wb = await Exporters.analysisWorkbook(md, a, S.config, cq);
      const buf = await wb.xlsx.writeBuffer(); loader(false);
      await saveFile(`Analisis de cartera ${a.label}.xlsx`, new Blob([buf]));
    } catch (e) { loader(false); console.error(e); toast('Error: ' + e.message); }
  }

  // ---------- PRESENTACIÓN ----------
  let slideIx = 0;
  function slidesData() {
    const a = agg(), p = prevAgg(), k = a.kpi, mf = C.metaFromAgg(p || a, S.config.meta, p ? 'sig' : 'mes');
    return { a, p, k, mf, cumpl: mf.meta ? k.recaudo / mf.meta : 0, ins: insights(a, p), rec: recomendaciones(a), next: C.metaFromAgg(a, S.config.meta, 'sig') };
  }
  function renderPres() {
    const v = $('#v-presentacion'); const a = agg(); if (!a) { v.innerHTML = emptyCTA(); return; }
    const D = slidesData(); const k = D.k;
    const foot = n => `<div class="foot"><span>Grupo de Servicios Financieros · Cierre ${esc(a.label)}</span><span>${n}</span></div>`;
    const hist = months().length > 1;
    const slides = [
      `<div class="slide cover"><div class="t1">Informe gerencial<br>de cartera</div><div class="bar"></div><div class="t2">Cierre de ${esc(a.label)} · Grupo de Servicios Financieros</div></div>`,
      `<div class="slide"><div class="band">Indicadores clave<small>${esc(a.label)}</small></div><div class="body"><div class="skpis">
        ${[['Cartera total', money0(k.cartera), int(k.prestamos) + ' préstamos'], ['PAR30', pct(k.par30Pct), money0(k.par30) + ' en riesgo'], ['PAR30 sin migrados', pct(k.par30NMPct), 'sobre ' + money0(k.carteraNM)], ['Recaudo del mes', money0(k.recaudo), pct(D.cumpl, 0) + ' de la meta'], ['Intereses + GM', money0(k.interesesMes + k.gmMes), 'devengados en el mes'], ['Cancelados', int(k.canceladosN), money0(k.canceladosMonto)]].map(x => `<div class="skpi"><div class="a">${x[0]}</div><div class="b">${x[1]}</div><div class="c">${x[2]}</div></div>`).join('')}
      </div></div>${foot(2)}</div>`,
      `<div class="slide"><div class="band">Composición de la cartera<small>por producto</small></div><div class="body"><div id="sP1" class="schart"></div></div>${foot(3)}</div>`,
      `<div class="slide"><div class="band">Calidad de la cartera<small>saldo por tramo de mora</small></div><div class="body"><div id="sP2" class="schart"></div></div>${foot(4)}</div>`,
      `<div class="slide"><div class="band">Dónde se concentra el riesgo<small>top patronos por PAR30</small></div><div class="body"><div id="sP3" class="schart"></div></div>${foot(5)}</div>`,
      `<div class="slide"><div class="band">Cobros vs meta<small>${esc(a.label)}</small></div><div class="body" style="display:grid;grid-template-columns:1fr 1.6fr;gap:3%"><div id="sP4a" class="schart"></div><div id="sP4b" class="schart"></div></div>${foot(6)}</div>`,
      ...(a.deep ? [`<div class="slide"><div class="band">Concentración: mayores clientes<small>${pct(a.deep.top25Pct)} de la cartera en 25 clientes</small></div><div class="body"><div id="sP7" class="schart"></div></div>${foot('')}</div>`] : []),
      ...(model() ? [`<div class="slide"><div class="band">10 mayores clientes<small>tramo de mora y estado</small></div><div class="body">${topSlideHtml(C.topClients(model(), 10))}</div>${foot('')}</div>`,
        `<div class="slide"><div class="band">10 mayores clientes fuera de 365 Mas<small>los más grandes que aún se pueden gestionar</small></div><div class="body">${topSlideHtml(C.topClients(model(), 10, g => g.bucket < 5), true)}</div>${foot('')}</div>`] : []),
      ...(a.deep ? [`<div class="slide"><div class="band">Cosechas y antigüedad de pago<small>saldo y PAR30 por año de desembolso</small></div><div class="body" style="display:grid;grid-template-columns:1.3fr 1fr;gap:3%"><div id="sP8" class="schart"></div><div id="sP9" class="schart"></div></div>${foot('')}</div>`] : []),
      ...(a.deep ? [`<div class="slide"><div class="band">Vencimientos y tasas<small>tasa promedio ${a.deep.tasaProm.toFixed(2)}% · plazo ${Math.round(a.deep.plazoProm)} meses</small></div><div class="body" style="display:grid;grid-template-columns:1fr 1fr;gap:3%"><div id="sP11a" class="schart"></div><div id="sP11b" class="schart"></div></div>${foot('')}</div>`] : []),
      ...(model() ? [`<div class="slide"><div class="band">Letras del mes<small>vencieron vs cobrado · ${esc(a.label)}</small></div><div class="body">${letrasSlideHtml()}</div>${foot('')}</div>`] : []),
      ...(model() ? [`<div class="slide"><div class="band">Meta de cobros por oficial<small>${esc(a.label)}</small></div><div class="body">${metaOfiSlideHtml(D)}</div>${foot('')}</div>`,
        `<div class="slide"><div class="band">Clientes a gestionar<small>mayor monto pendiente de la meta</small></div><div class="body">${gestionSlideHtml(D)}</div>${foot('')}</div>`] : []),
      ...(a.deep && a.deep.seguro ? [`<div class="slide"><div class="band">Seguro de vida y FECI<small>${esc(a.label)}</small></div><div class="body" style="display:grid;grid-template-columns:1fr 1fr;gap:3%"><div id="sP12a" class="schart"></div><div id="sP12b" class="schart"></div></div>${foot('')}</div>`] : []),
      `<div class="slide"><div class="band">Ingresos del mes<small>${esc(a.label)}</small></div><div class="body" style="display:grid;grid-template-columns:1fr 1.5fr;gap:3%"><div class="skpis" style="grid-template-columns:1fr 1fr;gap:4%">${[['Intereses', money0(k.interesesMes)], ['Gastos de manejo', money0(k.gmMes)], ['FECI', money0(k.feciMes)], ['Prima seguro vida', money0(k.segPrima)], ['Cancelados', int(k.canceladosN) + ' · ' + money0(k.canceladosMonto)], ['Vencidos con saldo', int(k.vencidosRepN || k.vencidosN)]].map(x => `<div class="skpi"><div class="a">${x[0]}</div><div class="b" style="font-size:clamp(10px,2vw,22px)">${x[1]}</div></div>`).join('')}</div><div id="sP10" class="schart"></div></div>${foot('')}</div>`,
      ...(hist ? [`<div class="slide"><div class="band">Evolución mensual<small>cartera, recaudo y PAR30</small></div><div class="body"><div id="sP6" class="schart"></div></div>${foot(7)}</div>`] : []),
      `<div class="slide"><div class="band">Hallazgos</div><div class="body"><ul class="slist">${D.ins.slice(0, 6).map(i => `<li>${esc(i.x)}</li>`).join('')}</ul></div>${foot(hist ? 8 : 7)}</div>`,
      `<div class="slide"><div class="band">Recomendaciones y próximos pasos</div><div class="body"><ul class="slist">${D.rec.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>${foot(hist ? 9 : 8)}</div>`
    ];
    for (let i = 0; i < slides.length; i++) slides[i] = slides[i].replace(/<div class="foot"><span>([^<]*)<\/span><span>[^<]*<\/span><\/div>/, (m, s) => `<div class="foot"><span>${s}</span><span>${i + 1}</span></div>`);
    slideIx = Math.min(slideIx, slides.length - 1);
    v.innerHTML = `
      <div class="vhead"><div><h2>Presentación gerencial</h2><p>Se arma sola con los datos del mes. Preséntala aquí en pantalla completa o descárgala en PowerPoint con gráficos editables.</p></div>
        <div class="tools" style="margin:0"><button class="btn" id="fsBtn">Pantalla completa</button><button class="btn pri" id="pptBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>PowerPoint</button></div></div>
      ${!model() || !a.deep ? `<div class="seedbar" style="margin-bottom:12px"><span>${!a.deep ? 'Este mes se guardó con una versión anterior del dashboard. ' : ''}Sin los reportes del mes cargados, la presentación sale <b>solo con totales</b>: le faltan los 25 mayores clientes, la meta por oficial y la lista de clientes a gestionar${!a.deep ? ', además de cosechas, vencimientos y tasas' : ''}.</span><button class="btn sm" onclick="document.getElementById('fileIn').click()">Cargar reportes</button></div>` : ''}
      <div class="deck" id="deck">${slides.join('')}</div>
      <div class="deckbar"><button class="btn sm" id="sPrev">‹ Anterior</button><div class="dots" id="sDots">${slides.map((_, i) => `<i data-i="${i}"></i>`).join('')}</div><button class="btn sm" id="sNext">Siguiente ›</button></div>`;
    const show = i => { slideIx = (i + slides.length) % slides.length; $$('#deck .slide').forEach((s, j) => s.classList.toggle('on', j === slideIx)); $$('#sDots i').forEach((d, j) => d.classList.toggle('on', j === slideIx)); drawSlideCharts(D); };
    $('#sPrev').onclick = () => show(slideIx - 1); $('#sNext').onclick = () => show(slideIx + 1);
    $$('#sDots i').forEach(d => d.onclick = () => show(+d.dataset.i));
    $('#deck').onclick = e => { if (e.target.closest('.schart')) return; const r = $('#deck').getBoundingClientRect(); show(slideIx + (e.clientX - r.left > r.width / 2 ? 1 : -1)); };
    document.onkeydown = e => { if (S.tab !== 'presentacion') return; if (e.key === 'ArrowRight' || e.key === ' ') show(slideIx + 1); if (e.key === 'ArrowLeft') show(slideIx - 1); };
    $('#fsBtn').onclick = async () => { const d = $('#deck'); try { if (d.requestFullscreen) await d.requestFullscreen(); else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen(); } catch (e) { toast('Pantalla completa no disponible aquí'); } };
    document.onfullscreenchange = () => { $('#deck') && $('#deck').classList.toggle('fs', !!document.fullscreenElement); setTimeout(() => Object.values(charts).forEach(c => c.resize()), 200); };
    $('#pptBtn').onclick = () => downloadPPT(D);
    show(slideIx);
  }
  function metaRowsByOficial() {
    const md = model(); if (!md) return [];
    const per = C.computeMeta(md.loans, S.config.meta, 'mes').perLoan; const m = new Map();
    md.loans.forEach(l => { const g = m.get(l.oficial) || { k: l.oficial, n: 0, meta: 0, real: 0, no: 0 }; const mt = per.get(l.id) || 0; g.n++; g.meta += mt; g.real += l.pagadoMes; if (mt > 0.005 && l.pagadoMes <= 0) g.no++; m.set(l.oficial, g); });
    return [...m.values()].sort((x, y) => y.meta - x.meta);
  }
  function gestionRows(n) {
    const md = model(); if (!md) return [];
    const per = C.computeMeta(md.loans, S.config.meta, 'mes').perLoan;
    return md.loans.map(l => ({ l, meta: per.get(l.id) || 0 })).map(x => Object.assign(x, { falta: Math.max(0, x.meta - x.l.pagadoMes) })).filter(x => x.falta > 0.5).sort((x, y) => (y.l.bucket > 0 && y.l.bucket < 4 ? 1 : 0) - (x.l.bucket > 0 && x.l.bucket < 4 ? 1 : 0) || y.falta - x.falta).slice(0, n || 10);
  }
  const slideTable = (heads, rows, right) => `<table style="width:100%;border-collapse:collapse;font-size:clamp(7px,1.15vw,14px)"><thead><tr style="background:#0f2a52;color:#fff">${heads.map((h, i) => `<th style="padding:.5em .7em;text-align:${right.includes(i) ? 'right' : 'left'}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r, j) => `<tr style="background:${j % 2 ? '#f1f5fb' : '#fff'}">${r.map((c, i) => `<td style="padding:.4em .7em;text-align:${right.includes(i) ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  function letrasSlideHtml() {
    const md = model(); if (!md) return ''; const E = letrasEstado(md, 'mes');
    const col = k => k === 'Pagó' ? '#16a34a' : k === 'Parcial' ? '#d97706' : '#dc2626';
    return `<div style="display:grid;grid-template-columns:1fr 1.6fr;gap:4%;height:100%"><div><div style="font-family:'Space Grotesk';font-weight:700;font-size:clamp(20px,4.5vw,54px);color:${E.cobrado >= E.total ? '#16a34a' : '#d97706'}">${pct(E.total ? E.cobrado / E.total : 0, 0)}</div><div style="font-size:clamp(8px,1.3vw,15px);color:#334155;margin-bottom:6%">de las letras del mes cobradas<br>${money0(E.cobrado)} de ${money0(E.total)}</div>${slideTable(['Estado', 'Préstamos', 'Falta'], E.porEstado.map(g => [`<b style="color:${col(g.k)}">${g.k}</b>`, int(g.n), money0(g.falta)]), [1, 2])}</div><div>${slideTable(['Sucursal', 'Préstamos', 'Vencieron', 'Cobrado', '%'], E.porSuc.map(g => [esc(g.k), int(g.n), money0(g.lt), money0(g.cob), pct(g.lt ? g.cob / g.lt : 0, 0)]), [1, 2, 3, 4])}</div></div>`;
  }
  function metaOfiSlideHtml() {
    const rows = metaRowsByOficial(); const t = rows.reduce((s, r) => ({ meta: s.meta + r.meta, real: s.real + r.real, no: s.no + r.no, n: s.n + r.n }), { meta: 0, real: 0, no: 0, n: 0 });
    return slideTable(['Oficial', 'Préstamos', 'Meta', 'Cobrado', 'Cumplimiento', 'Sin pagar'], rows.map(r => [esc(r.k), int(r.n), money0(r.meta), money0(r.real), `<b style="color:${r.real >= r.meta ? '#16a34a' : '#dc2626'}">${pct(r.meta ? r.real / r.meta : 0, 0)}</b>`, int(r.no)]).concat([['<b>Total</b>', `<b>${int(t.n)}</b>`, `<b>${money0(t.meta)}</b>`, `<b>${money0(t.real)}</b>`, `<b>${pct(t.meta ? t.real / t.meta : 0, 0)}</b>`, `<b>${int(t.no)}</b>`]]), [1, 2, 3, 4, 5]);
  }
  function gestionSlideHtml() {
    return slideTable(['Cliente', 'Patrono', 'Oficial', 'Tramo', 'Meta', 'Cobrado', 'Falta'], gestionRows(10).map(x => [esc(x.l.nombre), esc(String(x.l.patrono).slice(0, 26)), esc(x.l.oficial), `<span style="color:${x.l.bucket > 1 ? '#dc2626' : x.l.bucket ? '#d97706' : '#16a34a'};font-weight:600">${x.l.clas}</span>`, money0(x.meta), money0(x.l.pagadoMes), `<b>${money0(x.falta)}</b>`]), [4, 5, 6]);
  }
  const dmyS = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—';
  const colTramo = t => t.bucket >= 5 ? '#dc2626' : t.bucket > 1 ? '#ea580c' : t.bucket === 1 ? '#ca8a04' : '#16a34a';
  function topSlideHtml(top, conRankTotal) {
    const H = ['#', 'Cliente', 'Patrono', 'Saldo', '% cartera', 'Tramo', 'Días mora', 'Estado', 'Último pago'];
    const td = (x, st) => `<td style="padding:.38em .6em;${st || ''}">${x}</td>`;
    return `<table style="width:100%;border-collapse:collapse;font-size:clamp(7px,1.02vw,13px)"><thead><tr style="background:#0f2a52;color:#fff">${H.map(h => `<th style="padding:.5em .6em;text-align:${/Saldo|%|Días/.test(h) ? 'right' : 'left'}">${h}</th>`).join('')}</tr></thead><tbody>${top.map((t, i) => `<tr style="background:${i % 2 ? '#f1f5fb' : '#fff'}">${td(conRankTotal ? t.rankTotal : t.rank)}${td(esc(t.nombre))}${td(esc(String(t.patrono).replace(/\s+/g, ' ').slice(0, 32)))}${td(money0(t.saldo), 'text-align:right')}${td(pct(t.pct), 'text-align:right')}${td(t.clas, `color:${colTramo(t)};font-weight:700`)}${td(int(t.dias), 'text-align:right')}${td(t.estado, `font-weight:600;color:${t.estado === 'Vigente' ? '#334155' : '#b91c1c'}`)}${td(dmyS(t.fult))}</tr>`).join('')}</tbody></table>
      <div style="margin-top:.8em;font-size:clamp(7px,.9vw,12px);color:#64748b">Estado: <b>Vencido</b> = ya pasó la fecha de la última letra · <b>Vigente</b> = todavía tiene letras por vencer.${conRankTotal ? ' # = posición entre todos los clientes de la cartera.' : ''}</div>`;
  }
  function drawSlideCharts(D) {
    const a = D.a; const light = { textStyle: { fontFamily: 'Inter', color: '#334155' } };
    const ax = { axisLine: { lineStyle: { color: '#cbd5e1' } }, axisLabel: { color: '#334155', fontSize: 11 }, splitLine: { lineStyle: { color: '#eef2f7' } } };
    const on = id => { const el = document.getElementById(id); return el && el.closest('.slide').classList.contains('on'); };
    if (on('sP1')) chart('sP1', Object.assign({}, light, { tooltip: { trigger: 'item' }, legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: '#334155', fontSize: 11 } }, series: [{ type: 'pie', radius: ['40%', '75%'], center: ['35%', '50%'], itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { formatter: p => p.percent > 3 ? p.percent.toFixed(0) + '%' : '', color: '#0f1f3d' }, data: a.byProduct.map((x, i) => ({ name: shortName(x.k), value: x.saldo, itemStyle: { color: ['#1d4ed8', '#0ea5e9', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#64748b'][i % 8] } })) }] }));
    if (on('sP2')) chart('sP2', Object.assign({}, light, { tooltip: tip(), grid: { left: 70, right: 20, top: 30, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: C.BUCKETS.map(b => b + ' d') }, ax), yAxis: Object.assign({ type: 'value', axisLabel: { color: '#334155', formatter: v => short(v) } }, { splitLine: ax.splitLine }), series: [{ type: 'bar', barWidth: '55%', data: a.byBucket.map((b, i) => ({ value: Math.round(b.saldo), itemStyle: { color: ['#16a34a', '#84cc16', '#eab308', '#f97316', '#ef4444', '#be123c'][i], borderRadius: [6, 6, 0, 0] } })), label: { show: true, position: 'top', color: '#0f1f3d', formatter: p => short(p.value) + ' · ' + a.byBucket[p.dataIndex].n } }] }));
    if (on('sP3')) { const pats = (a.byPatrono || []).filter(x => !/^Otros/.test(x.k) && x.par30 > 0).sort((x, y) => y.par30 - x.par30).slice(0, 8); chart('sP3', Object.assign({}, light, { grid: { left: 10, right: 70, top: 10, bottom: 10, containLabel: true }, xAxis: { type: 'value', show: false }, yAxis: { type: 'category', inverse: true, data: pats.map(x => x.k.slice(0, 34)), axisLabel: { color: '#0f1f3d', fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } }, series: [{ type: 'bar', barWidth: '55%', data: pats.map(x => Math.round(x.par30)), itemStyle: { color: '#dc2626', borderRadius: [0, 6, 6, 0] }, label: { show: true, position: 'right', color: '#0f1f3d', formatter: p => short(p.value) } }] })); }
    if (on('sP4a')) {
      chart('sP4a', Object.assign({}, light, { series: [{ type: 'gauge', startAngle: 210, endAngle: -30, min: 0, max: 150, progress: { show: true, width: 14, roundCap: true, itemStyle: { color: D.cumpl >= 1 ? '#16a34a' : '#f59e0b' } }, axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, '#e2e8f0']] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, detail: { offsetCenter: [0, 0], fontSize: 28, fontWeight: 700, color: '#0f1f3d', formatter: v => v.toFixed(0) + '%' }, title: { offsetCenter: [0, '40%'], color: '#475569', fontSize: 12 }, data: [{ value: +(D.cumpl * 100).toFixed(1), name: `${short(D.k.recaudo)} de ${short(D.mf.meta)}` }] }] }));
      const rd = a.recaudoDiario || []; let acc = 0;
      chart('sP4b', Object.assign({}, light, { tooltip: tip({ axisPointer: { type: 'line' } }), grid: { left: 60, right: 20, top: 20, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: rd.map(x => x.d.slice(8, 10) + '/' + x.d.slice(5, 7)), boundaryGap: false }, ax), yAxis: Object.assign({ type: 'value', axisLabel: { color: '#334155', formatter: v => short(v) } }, { splitLine: ax.splitLine }), series: [{ type: 'line', smooth: true, showSymbol: false, data: rd.map(x => (acc += x.v)), lineStyle: { width: 3, color: '#1d4ed8' }, areaStyle: { color: 'rgba(29,78,216,.12)' }, markLine: { symbol: 'none', lineStyle: { color: '#f59e0b', type: 'dashed', width: 2 }, label: { formatter: 'Meta ' + short(D.mf.meta), color: '#b45309' }, data: [{ yAxis: D.mf.meta }] } }] }));
    }
    if (on('sP7') && a.deep) chart('sP7', Object.assign({}, light, { grid: { left: 60, right: 20, top: 20, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: a.deep.pareto.map(p => 'Top ' + p.n) }, ax), yAxis: Object.assign({ type: 'value', max: 1, axisLabel: { color: '#334155', formatter: v => v * 100 + '%' } }, { splitLine: ax.splitLine }), series: [{ type: 'bar', barWidth: '50%', data: a.deep.pareto.map(p => p.pct), itemStyle: { color: '#6366f1', borderRadius: [6, 6, 0, 0] }, label: { show: true, position: 'top', color: '#0f1f3d', formatter: p => pct(p.value) } }] }));
    if (on('sP8') && a.deep) { const vin = a.deep.byVintage; chart('sP8', Object.assign({}, light, { legend: { top: 0, textStyle: { color: '#334155' } }, grid: { left: 60, right: 44, top: 30, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: vin.map(x => x.k) }, ax), yAxis: [{ type: 'value', axisLabel: { color: '#334155', formatter: v => short(v) }, splitLine: ax.splitLine }, { type: 'value', max: 100, axisLabel: { color: '#334155', formatter: v => v + '%' }, splitLine: { show: false } }], series: [{ name: 'Saldo', type: 'bar', data: vin.map(x => x.saldo), itemStyle: { color: '#1d4ed8' } }, { name: 'PAR30 %', type: 'line', yAxisIndex: 1, data: vin.map(x => +(x.par30Pct * 100).toFixed(1)), lineStyle: { color: '#dc2626', width: 3 }, itemStyle: { color: '#dc2626' } }] }));
      const lp = a.deep.byLastPay; chart('sP9', Object.assign({}, light, { title: { text: 'Último pago', left: 'center', textStyle: { fontSize: 13, color: '#0f1f3d' } }, grid: { left: 10, right: 50, top: 30, bottom: 10, containLabel: true }, xAxis: { type: 'value', show: false }, yAxis: { type: 'category', inverse: true, data: lp.map(x => x.k), axisLabel: { color: '#0f1f3d', fontSize: 10.5 }, axisLine: { show: false }, axisTick: { show: false } }, series: [{ type: 'bar', barWidth: '55%', data: lp.map((x, i) => ({ value: x.saldo, itemStyle: { color: ['#16a34a', '#84cc16', '#eab308', '#f97316', '#ef4444', '#be123c', '#64748b'][i] } })), label: { show: true, position: 'right', color: '#0f1f3d', formatter: p => short(p.value) } }] })); }
    if (on('sP10')) { const ip = (a.interesesProducto || []).slice().sort((x, y) => (y.int + y.gm) - (x.int + x.gm)); chart('sP10', Object.assign({}, light, { legend: { top: 0, textStyle: { color: '#334155' } }, grid: { left: 10, right: 30, top: 30, bottom: 10, containLabel: true }, xAxis: { type: 'value', axisLabel: { color: '#334155', formatter: v => short(v) }, splitLine: ax.splitLine }, yAxis: { type: 'category', inverse: true, data: ip.map(x => shortName(x.k)), axisLabel: { color: '#0f1f3d', fontSize: 10.5 } }, series: [{ name: 'Intereses', type: 'bar', stack: 'i', data: ip.map(x => x.int), itemStyle: { color: '#1d4ed8' } }, { name: 'Gastos de manejo', type: 'bar', stack: 'i', data: ip.map(x => x.gm), itemStyle: { color: '#f59e0b' } }] })); }
    if (on('sP11a') && a.deep) { const hb = (id, rows, cols, t) => chart(id, Object.assign({}, light, { title: { text: t, left: 'center', textStyle: { fontSize: 13, color: '#0f1f3d' } }, grid: { left: 10, right: 60, top: 30, bottom: 10, containLabel: true }, xAxis: { type: 'value', show: false }, yAxis: { type: 'category', inverse: true, data: rows.map(x => x.k), axisLabel: { color: '#0f1f3d', fontSize: 10.5 }, axisLine: { show: false }, axisTick: { show: false } }, series: [{ type: 'bar', barWidth: '55%', data: rows.map((x, i) => ({ value: x.saldo, itemStyle: { color: cols[i % cols.length] } })), label: { show: true, position: 'right', color: '#0f1f3d', formatter: p => short(p.value) } }] }));
      hb('sP11a', a.deep.byMaturity, ['#dc2626', '#f59e0b', '#84cc16', '#16a34a', '#0ea5e9', '#6366f1'], 'Cuándo vence el saldo'); hb('sP11b', a.deep.byRate, ['#0ea5e9', '#1d4ed8', '#6366f1', '#a855f7', '#ec4899', '#64748b'], 'Saldo por tasa de interés'); }
    if (on('sP12a') && a.deep && a.deep.seguro) {
      const sa = a.deep.seguro.segAge; chart('sP12a', Object.assign({}, light, { title: { text: `Seguro de vida · prima ${money0(D.k.segPrima)} · ${D.k.segAsegurados} asegurados`, left: 'center', textStyle: { fontSize: 12, color: '#0f1f3d' } }, grid: { left: 50, right: 20, top: 40, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: sa.map(x => x.k) }, ax), yAxis: Object.assign({ type: 'value', axisLabel: { color: '#334155', formatter: v => '$' + v } }, { splitLine: ax.splitLine }), series: [{ type: 'bar', barWidth: '55%', data: sa.map(x => x.prima), itemStyle: { color: '#db2777', borderRadius: [6, 6, 0, 0] }, label: { show: true, position: 'top', color: '#0f1f3d', formatter: p => money0(p.value) + ' · ' + sa[p.dataIndex].n } }] }));
      const fb = a.deep.feci.byBucket; chart('sP12b', Object.assign({}, light, { title: { text: `FECI · saldo ${money0(D.k.feciSaldo)} · pagos del mes ${money0(D.k.feciPagosMes)}`, left: 'center', textStyle: { fontSize: 12, color: '#0f1f3d' } }, grid: { left: 60, right: 20, top: 40, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: fb.map(x => x.k) }, ax), yAxis: Object.assign({ type: 'value', axisLabel: { color: '#334155', formatter: v => short(v) } }, { splitLine: ax.splitLine }), series: [{ type: 'bar', barWidth: '55%', data: fb.map(x => x.feci), itemStyle: { color: '#0891b2', borderRadius: [6, 6, 0, 0] }, label: { show: true, position: 'top', color: '#0f1f3d', formatter: p => short(p.value) } }] })); }
    if (on('sP6')) { const H = months().map(m => S.history[m]); chart('sP6', Object.assign({}, light, { tooltip: tip(), legend: { top: 0, textStyle: { color: '#334155' } }, grid: { left: 60, right: 50, top: 34, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: H.map(h => h.label) }, ax), yAxis: [{ type: 'value', axisLabel: { color: '#334155', formatter: v => short(v) }, splitLine: ax.splitLine }, { type: 'value', axisLabel: { color: '#334155', formatter: v => v + '%' }, splitLine: { show: false } }], series: [{ name: 'Cartera', type: 'bar', data: H.map(h => h.kpi.cartera), itemStyle: { color: '#1d4ed8' } }, { name: 'Recaudo', type: 'bar', data: H.map(h => h.kpi.recaudo), itemStyle: { color: '#22c55e' } }, { name: 'PAR30 %', type: 'line', yAxisIndex: 1, data: H.map(h => +(h.kpi.par30Pct * 100).toFixed(1)), lineStyle: { color: '#dc2626', width: 3 }, itemStyle: { color: '#dc2626' } }] })); }
  }
  async function downloadPPT(D) {
    loader(true, 'Armando la presentación…', 25);
    try {
      await loadScript('pptx');
      const a = D.a, k = D.k;
      const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = 'Informe gerencial de cartera ' + a.label;
      const NAVY = '0F2A52', BLUE = '1D4ED8', GREY = '64748B';
      pptx.defineSlideMaster({ title: 'M', background: { color: 'FFFFFF' }, objects: [{ rect: { x: 0, y: 0, w: 13.33, h: 0.9, fill: { color: NAVY } } }, { text: { text: `Grupo de Servicios Financieros · Cierre ${a.label}`, options: { x: 0.5, y: 7.05, w: 8, h: 0.3, fontSize: 10, color: GREY } } }], slideNumber: { x: 12.4, y: 7.05, fontSize: 10, color: GREY } });
      const title = (s, t, sub) => { s.addText(t, { x: 0.5, y: 0.12, w: 9, h: 0.66, fontSize: 24, bold: true, color: 'FFFFFF', fontFace: 'Calibri' }); if (sub) s.addText(sub, { x: 8.8, y: 0.12, w: 4, h: 0.66, fontSize: 12, color: 'C7D2FE', align: 'right' }); };
      let s = pptx.addSlide(); s.background = { color: '0B1530' };
      s.addShape(pptx.ShapeType.rect, { x: 0.9, y: 3.85, w: 1.6, h: 0.08, fill: { color: '38BDF8' } });
      s.addText('Informe gerencial\nde cartera', { x: 0.9, y: 1.6, w: 10, h: 2.1, fontSize: 44, bold: true, color: 'FFFFFF', fontFace: 'Calibri' });
      s.addText(`Cierre de ${a.label} · Grupo de Servicios Financieros`, { x: 0.9, y: 4.1, w: 10, h: 0.6, fontSize: 18, color: 'CBD5E1' });
      s = pptx.addSlide({ masterName: 'M' }); title(s, 'Indicadores clave', a.label);
      const tiles = [['Cartera total', money0(k.cartera), int(k.prestamos) + ' préstamos'], ['PAR30', pct(k.par30Pct), money0(k.par30) + ' en riesgo'], ['PAR30 sin migrados', pct(k.par30NMPct), 'sobre ' + money0(k.carteraNM)], ['Recaudo del mes', money0(k.recaudo), pct(D.cumpl, 0) + ' de la meta'], ['Intereses + GM', money0(k.interesesMes + k.gmMes), 'devengados en el mes'], ['Cancelados', int(k.canceladosN), money0(k.canceladosMonto)]];
      tiles.forEach((t, i) => { const x = 0.6 + (i % 3) * 4.1, y = 1.5 + Math.floor(i / 3) * 2.6; s.addShape(pptx.ShapeType.rect, { x, y, w: 3.8, h: 2.2, fill: { color: 'F1F5FB' }, line: { color: 'F1F5FB' } }); s.addShape(pptx.ShapeType.rect, { x, y, w: 0.09, h: 2.2, fill: { color: BLUE }, line: { color: BLUE } }); s.addText(t[0].toUpperCase(), { x: x + 0.3, y: y + 0.2, w: 3.3, h: 0.4, fontSize: 12, bold: true, color: '475569' }); s.addText(t[1], { x: x + 0.3, y: y + 0.65, w: 3.4, h: 0.9, fontSize: 30, bold: true, color: '0F1F3D' }); s.addText(t[2], { x: x + 0.3, y: y + 1.5, w: 3.4, h: 0.4, fontSize: 12, color: GREY }); });
      s = pptx.addSlide({ masterName: 'M' }); title(s, 'Composición de la cartera', 'por producto');
      s.addChart(pptx.ChartType.doughnut, [{ name: 'Saldo', labels: a.byProduct.map(x => shortName(x.k)), values: a.byProduct.map(x => Math.round(x.saldo)) }], { x: 0.6, y: 1.2, w: 12, h: 5.7, holeSize: 55, showLegend: true, legendPos: 'r', legendFontSize: 12, showPercent: true, showValue: false, dataLabelColor: 'FFFFFF', chartColors: ['1D4ED8', '0EA5E9', '22C55E', 'F59E0B', 'A855F7', 'EF4444', '14B8A6', '64748B'] });
      s = pptx.addSlide({ masterName: 'M' }); title(s, 'Calidad de la cartera', 'saldo por tramo de mora');
      s.addChart(pptx.ChartType.bar, [{ name: 'Saldo', labels: C.BUCKETS.map(b => b + ' días'), values: a.byBucket.map(b => Math.round(b.saldo)) }], { x: 0.6, y: 1.2, w: 8.2, h: 5.7, barDir: 'col', chartColors: ['16A34A', '84CC16', 'EAB308', 'F97316', 'EF4444', 'BE123C'], showValue: true, dataLabelFormatCode: '$#,##0', valAxisLabelFormatCode: '$#,##0', catAxisLabelFontSize: 11, showLegend: false, varyColors: true });
      s.addTable([[{ text: 'Tramo', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } }, { text: '# Prést.', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } }, { text: 'Saldo', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } }], ...a.byBucket.map(b => [b.k, String(b.n), money0(b.saldo)])], { x: 9.1, y: 1.5, w: 3.7, fontSize: 11, border: { type: 'solid', color: 'E2E8F0', pt: 1 }, colW: [1.1, 0.9, 1.7] });
      s = pptx.addSlide({ masterName: 'M' }); title(s, 'Dónde se concentra el riesgo', 'top patronos por PAR30');
      const pats = (a.byPatrono || []).filter(x => !/^Otros/.test(x.k) && x.par30 > 0).sort((x, y) => y.par30 - x.par30).slice(0, 8);
      s.addChart(pptx.ChartType.bar, [{ name: 'PAR30', labels: pats.map(x => x.k.slice(0, 40)), values: pats.map(x => Math.round(x.par30)) }], { x: 0.6, y: 1.2, w: 12, h: 5.7, barDir: 'bar', chartColors: ['DC2626'], showValue: true, dataLabelFormatCode: '$#,##0', valAxisHidden: true, catAxisOrientation: 'maxMin', catAxisLabelFontSize: 12, showLegend: false });
      s = pptx.addSlide({ masterName: 'M' }); title(s, 'Cobros vs meta', a.label);
      s.addText(pct(D.cumpl, 0), { x: 0.7, y: 1.6, w: 3.6, h: 1.4, fontSize: 60, bold: true, color: D.cumpl >= 1 ? '16A34A' : 'D97706' });
      s.addText(`de cumplimiento\n${money0(k.recaudo)} cobrado\nMeta ${money0(D.mf.meta)}\n(cuotas ${money0(D.mf.metaCuotas)} + recuperación ${money0(D.mf.metaRecup)})`, { x: 0.7, y: 3.0, w: 3.8, h: 2.4, fontSize: 14, color: '334155' });
      s.addText(`Meta propuesta ${C.monthLabel(C.nextMonth(a.month))}: ${money0(D.next.meta)}`, { x: 0.7, y: 5.6, w: 4, h: 0.6, fontSize: 14, bold: true, color: BLUE });
      const rd = a.recaudoDiario || []; let acc = 0;
      if (rd.length) s.addChart(pptx.ChartType.line, [{ name: 'Cobrado acumulado', labels: rd.map(x => x.d.slice(8, 10) + '/' + x.d.slice(5, 7)), values: rd.map(x => Math.round(acc += x.v)) }, { name: 'Meta', labels: rd.map(x => x.d.slice(8, 10)), values: rd.map(() => Math.round(D.mf.meta)) }], { x: 4.8, y: 1.2, w: 8, h: 5.7, chartColors: ['1D4ED8', 'F59E0B'], lineSize: 3, lineDataSymbol: 'none', valAxisLabelFormatCode: '$#,##0', showLegend: true, legendPos: 'b' });
      const md = model();
      if (a.deep) {
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Concentración: mayores clientes', pct(a.deep.top25Pct) + ' de la cartera en 25 clientes');
        s.addChart(pptx.ChartType.bar, [{ name: '% de la cartera', labels: a.deep.pareto.map(p => 'Top ' + p.n), values: a.deep.pareto.map(p => Math.round(p.pct * 1000) / 10) }], { x: 0.5, y: 1.2, w: 12.3, h: 5.2, barDir: 'col', chartColors: ['6366F1'], valAxisMaxVal: 100, valAxisLabelFormatCode: '0"%"', showValue: true, dataLabelFormatCode: '0.0"%"', dataLabelColor: '0F1F3D', showLegend: false, catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, dataLabelFontSize: 12 });
        s.addText(a.deep.pareto.map(p => `Top ${p.n}: ${pct(p.pct)}`).join('   ·   '), { x: 0.5, y: 6.45, w: 12.3, h: 0.4, fontSize: 13, color: BLUE, bold: true });
      }
      if (md) {
        const H = o => ({ text: o, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } });
        const colT = t => t.bucket >= 5 ? 'DC2626' : t.bucket > 1 ? 'EA580C' : t.bucket === 1 ? 'CA8A04' : '16A34A';
        const topTable = (titulo, sub, top, rankTotal) => {
          s = pptx.addSlide({ masterName: 'M' }); title(s, titulo, sub);
          s.addTable([[H('#'), H('Cliente'), H('Patrono'), H('Saldo'), H('% cartera'), H('Tramo'), H('Días mora'), H('Estado'), H('Último pago')],
            ...top.map(t => [String(rankTotal ? t.rankTotal : t.rank), t.nombre, String(t.patrono).replace(/\s+/g, ' ').slice(0, 32), money0(t.saldo), pct(t.pct), { text: t.clas, options: { color: colT(t), bold: true } }, int(t.dias), { text: t.estado, options: { color: t.estado === 'Vigente' ? '334155' : 'B91C1C', bold: true } }, dmyS(t.fult)])],
            { x: 0.4, y: 1.15, w: 12.5, fontSize: 11, rowH: 0.42, border: { type: 'solid', color: 'E2E8F0', pt: 1 }, colW: [0.45, 3.2, 2.75, 1.15, 0.95, 1.0, 0.85, 1.15, 1.0], fill: { color: 'FFFFFF' }, color: '0F1F3D' });
          s.addText('Estado: Vencido = ya pasó la fecha de la última letra · Vigente = todavía tiene letras por vencer.' + (rankTotal ? '  # = posición entre todos los clientes.' : ''), { x: 0.4, y: 6.5, w: 12.5, h: 0.35, fontSize: 10, color: '64748B' });
        };
        topTable('10 mayores clientes', 'tramo de mora y estado', C.topClients(md, 10));
        topTable('10 mayores clientes fuera de 365 Mas', 'los más grandes que aún se pueden gestionar', C.topClients(md, 10, g => g.bucket < 5), true);
      }
      if (a.deep) {
        const vin = a.deep.byVintage, lp = a.deep.byLastPay;
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Cosechas y antigüedad de pago', a.label);
        s.addChart(pptx.ChartType.bar, [{ name: 'Saldo', labels: vin.map(x => x.k), values: vin.map(x => Math.round(x.saldo)) }], { x: 0.5, y: 1.2, w: 6.4, h: 5.6, barDir: 'col', chartColors: ['1D4ED8'], valAxisLabelFormatCode: '$#,##0', showLegend: false, showTitle: true, title: 'Saldo por año de desembolso', titleFontSize: 13 });
        s.addTable([[{ text: 'Cosecha', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } }, { text: 'PAR30 %', options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } }], ...vin.map(x => [x.k, pct(x.par30Pct)])], { x: 7.1, y: 1.3, w: 2.1, fontSize: 10, border: { type: 'solid', color: 'E2E8F0', pt: 1 } });
        s.addChart(pptx.ChartType.bar, [{ name: 'Saldo', labels: lp.map(x => x.k), values: lp.map(x => Math.round(x.saldo)) }], { x: 9.3, y: 1.2, w: 3.8, h: 5.6, barDir: 'bar', chartColors: ['16A34A', '84CC16', 'EAB308', 'F97316', 'EF4444', 'BE123C', '64748B'], varyColors: true, catAxisOrientation: 'maxMin', valAxisHidden: true, showValue: true, dataLabelFormatCode: '$#,##0', showLegend: false, showTitle: true, title: 'Último pago', titleFontSize: 13, catAxisLabelFontSize: 9 });
      }
      if (a.deep) {
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Vencimientos y tasas', `tasa promedio ${a.deep.tasaProm.toFixed(2)}% · plazo ${Math.round(a.deep.plazoProm)} meses`);
        s.addChart(pptx.ChartType.bar, [{ name: 'Saldo', labels: a.deep.byMaturity.map(x => x.k), values: a.deep.byMaturity.map(x => Math.round(x.saldo)) }], { x: 0.5, y: 1.2, w: 6.1, h: 5.6, barDir: 'bar', chartColors: ['DC2626', 'F59E0B', '84CC16', '16A34A', '0EA5E9', '6366F1'], varyColors: true, catAxisOrientation: 'maxMin', valAxisHidden: true, showValue: true, dataLabelFormatCode: '$#,##0', showLegend: false, showTitle: true, title: 'Cuándo vence el saldo', titleFontSize: 13 });
        s.addChart(pptx.ChartType.bar, [{ name: 'Saldo', labels: a.deep.byRate.map(x => x.k), values: a.deep.byRate.map(x => Math.round(x.saldo)) }], { x: 6.8, y: 1.2, w: 6.1, h: 5.6, barDir: 'bar', chartColors: ['0EA5E9', '1D4ED8', '6366F1', 'A855F7', 'EC4899', '64748B'], varyColors: true, catAxisOrientation: 'maxMin', valAxisHidden: true, showValue: true, dataLabelFormatCode: '$#,##0', showLegend: false, showTitle: true, title: 'Saldo por tasa de interés', titleFontSize: 13 });
      }
      if (md) {
        // resumen de letras del mes (estado de pago)
        { const E = letrasEstado(md, 'mes'); const HD0 = o => ({ text: o, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } });
          s = pptx.addSlide({ masterName: 'M' }); title(s, 'Letras del mes', 'vencieron vs cobrado · ' + a.label);
          s.addText(pct(E.total ? E.cobrado / E.total : 0, 0), { x: 0.6, y: 1.3, w: 4, h: 1.1, fontSize: 54, bold: true, color: E.cobrado >= E.total ? '16A34A' : 'D97706' });
          s.addText(`de las letras del mes cobradas\n${money0(E.cobrado)} de ${money0(E.total)}`, { x: 0.6, y: 2.4, w: 5.2, h: 0.9, fontSize: 15, color: '334155' });
          s.addTable([[HD0('Estado'), HD0('Préstamos'), HD0('Falta')], ...E.porEstado.map(g => [{ text: g.k, options: { bold: true, color: g.k === 'Pagó' ? '16A34A' : g.k === 'Parcial' ? 'D97706' : 'DC2626' } }, String(g.n), money0(g.falta)])], { x: 0.6, y: 3.6, w: 5.2, fontSize: 14, rowH: 0.45, border: { type: 'solid', color: 'E2E8F0', pt: 1 } });
          s.addTable([[HD0('Sucursal'), HD0('Préstamos'), HD0('Vencieron'), HD0('Cobrado'), HD0('%')], ...E.porSuc.map(g => [g.k, String(g.n), money0(g.lt), money0(g.cob), pct(g.lt ? g.cob / g.lt : 0, 0)])], { x: 6.2, y: 1.3, w: 6.7, fontSize: 13, rowH: 0.42, border: { type: 'solid', color: 'E2E8F0', pt: 1 } }); }
        const HD = o => ({ text: o, options: { bold: true, color: 'FFFFFF', fill: { color: NAVY } } });
        const mo = metaRowsByOficial(); const tt = mo.reduce((q, r) => ({ meta: q.meta + r.meta, real: q.real + r.real, no: q.no + r.no, n: q.n + r.n }), { meta: 0, real: 0, no: 0, n: 0 });
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Meta de cobros por oficial', a.label);
        s.addTable([[HD('Oficial'), HD('Préstamos'), HD('Meta'), HD('Cobrado'), HD('Cumplimiento'), HD('Sin pagar')], ...mo.map(r => [r.k, int(r.n), money0(r.meta), money0(r.real), { text: pct(r.meta ? r.real / r.meta : 0, 0), options: { bold: true, color: r.real >= r.meta ? '16A34A' : 'DC2626' } }, int(r.no)]), [{ text: 'Total', options: { bold: true } }, { text: int(tt.n), options: { bold: true } }, { text: money0(tt.meta), options: { bold: true } }, { text: money0(tt.real), options: { bold: true } }, { text: pct(tt.meta ? tt.real / tt.meta : 0, 0), options: { bold: true } }, { text: int(tt.no), options: { bold: true } }]], { x: 0.5, y: 1.3, w: 12.3, fontSize: 15, rowH: 0.5, border: { type: 'solid', color: 'E2E8F0', pt: 1 }, align: 'left' });
        const gr = gestionRows(10);
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Clientes a gestionar', 'mayor monto pendiente de la meta');
        s.addTable([[HD('Cliente'), HD('Patrono'), HD('Oficial'), HD('Tramo'), HD('Meta'), HD('Cobrado'), HD('Falta')], ...gr.map(x => [x.l.nombre, String(x.l.patrono).slice(0, 30), x.l.oficial, { text: x.l.clas, options: { bold: true, color: x.l.bucket > 1 ? 'DC2626' : x.l.bucket ? 'D97706' : '16A34A' } }, money0(x.meta), money0(x.l.pagadoMes), { text: money0(x.falta), options: { bold: true } }])], { x: 0.5, y: 1.2, w: 12.3, fontSize: 12, rowH: 0.42, border: { type: 'solid', color: 'E2E8F0', pt: 1 }, colW: [3.6, 3.2, 1.3, 1.1, 1.0, 1.0, 1.1] });
      }
      if (a.deep && a.deep.seguro) {
        const sa = a.deep.seguro.segAge, fb = a.deep.feci.byBucket;
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Seguro de vida y FECI', a.label);
        s.addChart(pptx.ChartType.bar, [{ name: 'Prima', labels: sa.map(x => x.k), values: sa.map(x => +x.prima.toFixed(2)) }], { x: 0.5, y: 1.2, w: 6.1, h: 5.4, barDir: 'col', chartColors: ['DB2777'], showValue: true, dataLabelFormatCode: '$#,##0', valAxisLabelFormatCode: '$#,##0', showLegend: false, showTitle: true, title: `Seguro de vida · prima ${money0(k.segPrima)} · ${k.segAsegurados} asegurados`, titleFontSize: 12 });
        s.addChart(pptx.ChartType.bar, [{ name: 'Saldo FECI', labels: fb.map(x => x.k), values: fb.map(x => Math.round(x.feci)) }], { x: 6.8, y: 1.2, w: 6.1, h: 5.4, barDir: 'col', chartColors: ['0891B2'], showValue: true, dataLabelFormatCode: '$#,##0', valAxisLabelFormatCode: '$#,##0', showLegend: false, showTitle: true, title: `FECI · saldo ${money0(k.feciSaldo)} · pagos del mes ${money0(k.feciPagosMes)}`, titleFontSize: 12 });
        s.addText(`${a.deep.seguro.sinSeguroSonVencidos ? 'Fuera del informe de seguro (préstamos vencidos)' : 'Préstamos sin seguro de vida'}: ${a.deep.seguro.sinSeguroN} (${money0(a.deep.seguro.sinSeguroSaldo)})   ·   Seguro a pagar con ITBMS: ${money0(k.segPrima * 1.05)}`, { x: 0.5, y: 6.65, w: 12.3, h: 0.35, fontSize: 12, color: BLUE, bold: true });
      }
      {
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Ingresos del mes', a.label);
        const tl = [['Intereses', money0(k.interesesMes)], ['Gastos de manejo', money0(k.gmMes)], ['FECI', money0(k.feciMes)], ['Prima seguro vida', money0(k.segPrima)], ['Cancelados', int(k.canceladosN) + ' · ' + money0(k.canceladosMonto)], ['Vencidos con saldo', int(k.vencidosRepN || k.vencidosN)]];
        tl.forEach((t, i) => { const x = 0.5 + (i % 2) * 2.6, y = 1.3 + Math.floor(i / 2) * 1.85; s.addShape(pptx.ShapeType.rect, { x, y, w: 2.4, h: 1.6, fill: { color: 'F1F5FB' }, line: { color: 'F1F5FB' } }); s.addShape(pptx.ShapeType.rect, { x, y, w: 0.07, h: 1.6, fill: { color: BLUE }, line: { color: BLUE } }); s.addText(t[0].toUpperCase(), { x: x + 0.2, y: y + 0.15, w: 2.1, h: 0.4, fontSize: 10, bold: true, color: '475569' }); s.addText(t[1], { x: x + 0.2, y: y + 0.6, w: 2.2, h: 0.7, fontSize: 18, bold: true, color: '0F1F3D' }); });
        const ip = (a.interesesProducto || []).slice().sort((x, y) => (y.int + y.gm) - (x.int + x.gm));
        if (ip.length) s.addChart(pptx.ChartType.bar, [{ name: 'Intereses', labels: ip.map(x => shortName(x.k)), values: ip.map(x => Math.round(x.int)) }, { name: 'Gastos de manejo', labels: ip.map(x => shortName(x.k)), values: ip.map(x => Math.round(x.gm)) }], { x: 5.9, y: 1.2, w: 7, h: 5.6, barDir: 'bar', barGrouping: 'stacked', chartColors: ['1D4ED8', 'F59E0B'], catAxisOrientation: 'maxMin', valAxisLabelFormatCode: '$#,##0', showLegend: true, legendPos: 'b', catAxisLabelFontSize: 10 });
      }
      if (months().length > 1) {
        const H = months().map(m => S.history[m]);
        s = pptx.addSlide({ masterName: 'M' }); title(s, 'Evolución mensual', 'cartera y recaudo');
        s.addChart(pptx.ChartType.bar, [{ name: 'Cartera', labels: H.map(h => h.label), values: H.map(h => Math.round(h.kpi.cartera)) }, { name: 'Recaudo', labels: H.map(h => h.label), values: H.map(h => Math.round(h.kpi.recaudo)) }], { x: 0.6, y: 1.2, w: 8, h: 5.7, barDir: 'col', chartColors: ['1D4ED8', '22C55E'], valAxisLabelFormatCode: '$#,##0', showLegend: true, legendPos: 'b' });
        s.addChart(pptx.ChartType.line, [{ name: 'PAR30 %', labels: H.map(h => h.label), values: H.map(h => +(h.kpi.par30Pct * 100).toFixed(1)) }], { x: 8.8, y: 1.2, w: 4, h: 5.7, chartColors: ['DC2626'], lineSize: 3, showValue: true, showLegend: true, legendPos: 'b' });
      }
      s = pptx.addSlide({ masterName: 'M' }); title(s, 'Hallazgos');
      s.addText(D.ins.slice(0, 6).map(i => ({ text: i.x, options: { bullet: true, breakLine: true } })), { x: 0.7, y: 1.3, w: 11.9, h: 5.6, fontSize: 16, color: '1E293B', paraSpaceAfter: 10, valign: 'top' });
      s = pptx.addSlide({ masterName: 'M' }); title(s, 'Recomendaciones y próximos pasos');
      s.addText(D.rec.map(i => ({ text: i, options: { bullet: { type: 'number' }, breakLine: true } })), { x: 0.7, y: 1.3, w: 11.9, h: 5.6, fontSize: 17, color: '1E293B', paraSpaceAfter: 12, valign: 'top' });
      loader(true, 'Generando archivo…', 80);
      const blob = await pptx.write({ outputType: 'blob' });
      loader(false);
      await saveFile(`Informe gerencial de cartera ${a.label}.pptx`, blob);
    } catch (e) { loader(false); console.error(e); toast('Error al generar la presentación: ' + e.message); }
  }

  // ---------- VER REPORTES ----------
  async function loadOriginals(ym) {
    const { archivos } = await gsPost({ action: 'getFiles', month: ym });
    const out = [];
    for (const a of archivos || []) {
      const buf = await gunzipBytes(a.data);
      let rp; try { rp = C.readReport(buf, a.nombre); } catch (e) { rp = { key: null, filename: a.nombre, name: a.nombre, meta: {}, aoa: [], rows: [] }; }
      rp.raw = buf; out.push(rp);
    }
    return out;
  }
  function renderReportes() {
    const v = $('#v-reportes'); const ym = S.current;
    let reps = reports(); if (!reps.length && S.orig && S.orig[ym]) reps = S.orig[ym];
    const yaTraidos = !!(S.orig && S.orig[ym]);
    const canFetch = !reps.length && !yaTraidos && ym && gsOn() && S.gsDetalle[ym] && puede('getFiles');
    const fileName = r => r.filename.replace(/^[0-9a-f]{8}-/, '');
    const conRaw = reps.filter(r => r.raw);
    v.innerHTML = `<div class="vhead"><div><h2>Ver reportes</h2><p>Los Excel tal como vienen del SIF. Puedes verlos aquí o descargar el archivo original otra vez.</p></div>${conRaw.length && puede('descargar') ? `<div class="tools" style="margin:0"><button class="btn pri" id="repAll"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>Descargar todos (${conRaw.length})</button></div>` : ''}</div>
      ${reps.length ? `<div class="replist" id="repList">${reps.map((r, i) => `<div class="rep ${r.key ? 'ok' : ''}"><span class="dot"></span><div class="nm"><b title="${esc(fileName(r))}">${esc(r.name)}</b><span>${int(r.rows.length)} filas de detalle · ${esc(fileName(r))}</span></div><div style="display:flex;gap:6px">${r.raw && puede('descargar') ? `<button class="btn sm ghost" data-dl="${i}" title="Descargar el archivo original">Descargar</button>` : ''}<button class="btn sm" data-i="${i}">Ver</button></div></div>`).join('')}</div><div class="card mt" id="repView" style="display:none"></div>`
        : canFetch ? `<div class="card"><div class="muted">Trayendo los reportes originales de ${esc(C.monthLabel(ym))} desde Google Sheets…</div></div>`
        : yaTraidos ? '<div class="card"><div class="muted">Este mes se guardó antes de que el dashboard conservara los reportes originales. Vuelve a cargar sus reportes una vez y quedarán guardados para descargarlos cuando quieras.</div></div>'
        : `<div class="card">${S.gsDetalle[ym] && gsOn() && !puede('getFiles') ? '<div class="muted">Tu rol no permite ver ni descargar los reportes originales.</div>' : needDetail('Aquí puedes abrir y descargar cada Excel original. Los meses guardados en Google Sheets con detalle conservan los originales desde que se cargan.')}</div>`}`;
    if (canFetch) { ensureOriginals(ym, () => { if (S.tab === 'reportes') renderReportes(); }); return; }
    const dlOne = r => saveFile(fileName(r), new Blob([r.raw], { type: 'application/vnd.ms-excel' }));
    $$('[data-dl]', v).forEach(b => b.onclick = () => dlOne(reps[+b.dataset.dl]));
    $('#repAll') && ($('#repAll').onclick = async () => { for (const r of conRaw) { await dlOne(r); await new Promise(x => setTimeout(x, 450)); } });
    $$('#repList button[data-i]').forEach(b => b.onclick = () => {
      const r = reps[+b.dataset.i]; const box = $('#repView');
      if (box.dataset.i === b.dataset.i && box.style.display !== 'none') { box.style.display = 'none'; b.textContent = 'Ver'; return; }
      $$('#repList button[data-i]').forEach(x => x.textContent = 'Ver'); b.textContent = 'Ocultar';
      box.dataset.i = b.dataset.i; box.style.display = 'block';
      const aoa = r.aoa.filter(row => row && row.some(x => x != null && x !== ''));
      const width = Math.max(...aoa.slice(0, 200).map(x => x.length));
      const cols = Array.from({ length: width }, (_, j) => ({ h: XLSX.utils.encode_col(j), v: row => row[j] == null ? '' : row[j], n: false, f: (x) => typeof x === 'number' ? (x > 20000 && x < 60000 && Number.isInteger(x) ? dd(C.validDate(new Date(Math.round((x - 25569) * 864e5)).toISOString().slice(0, 10))) + '' : nf2.format(x)) : esc(x) }));
      box.innerHTML = `<h3>${esc(r.name)} <button class="btn sm ghost" id="repClose">Cerrar</button></h3><div id="repTbl"></div>`;
      table($('#repTbl'), cols, aoa, { pageSize: 100, sort: -1 });
      $('#repClose').onclick = () => { box.style.display = 'none'; b.textContent = 'Ver'; };
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // ---------- CARGAR ----------
  let usersSeq = 0;
async function renderUsuarios() {
  const v = $('#v-usuarios');
  v.innerHTML = `<div class="vhead"><div><h2>Usuarios y jerarquía</h2><p>Quién entra al dashboard, qué rol tiene y a quién reporta. Solo la cuenta de Administración puede cambiarlo.</p></div></div><div id="gsUsersBox"><div class="card"><div class="muted">Cargando usuarios desde Google Sheets…</div></div></div>`;
  if (window.claude || !gsOn()) { $('#gsUsersBox').innerHTML = '<div class="card"><div class="muted">Los usuarios se administran en la página publicada (GitHub Pages o Vercel) con la sesión iniciada.</div></div>'; return; }
  if (!puede('usuarios')) { $('#gsUsersBox').innerHTML = '<div class="card"><div class="muted">Solo la cuenta de Administración puede ver y cambiar los usuarios.</div></div>'; return; }
  const seq = ++usersSeq;
  const box = $('#gsUsersBox');
  {
    try {
      const { usuarios: todos } = await gsCall({ action: 'listUsers' }, 60000); if (seq !== usersSeq) return;
      const pend = todos.filter(u => u.estado === 'pendiente'), usuarios = todos.filter(u => u.estado !== 'pendiente' && u.estado !== 'rechazado'), rech = todos.filter(u => u.estado === 'rechazado');
      S.pendientes = pend.length; aplicarPermisos();
      const APP = location.origin + location.pathname;
      const me = gsCfg().me.usuario, opRol = sel => Object.keys(ROL_NOMBRE).map(r => `<option value="${r}" ${r === sel ? 'selected' : ''}>${ROL_NOMBRE[r]}</option>`).join('');
      const opJefe = (sel, yo) => '<option value="">— nadie —</option>' + usuarios.filter(u => u.usuario !== yo).map(u => `<option value="${esc(u.usuario)}" ${u.usuario === sel ? 'selected' : ''}>${esc(u.nombre || u.usuario)}</option>`).join('');
      // árbol de la jerarquía (a quién reporta cada persona)
      const hijos = j => usuarios.filter(u => (u.jefe || '') === j || (j === '' && u.jefe && !usuarios.some(x => x.usuario === u.jefe)));
      const arbol = (j, d) => hijos(j).map(u => `<div style="padding:5px 0 5px ${d * 22}px;${u.activo ? '' : 'opacity:.45'}">${d ? '└ ' : ''}<b>${esc(u.nombre || u.usuario)}</b> <span class="muted">· ${ROL_NOMBRE[u.rol]}</span></div>` + (d < 10 ? arbol(u.usuario, d + 1) : '')).join('');
      const fecha = x => x ? new Date(x).toLocaleDateString('es-PA', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      const pendHtml = `<div class="card" style="padding:14px;margin-bottom:14px;${pend.length ? 'border-color:#f59e0b' : ''}"><h3 style="margin:0 0 8px">Solicitudes de acceso ${pend.length ? `<span class="chip down">${pend.length} pendiente${pend.length > 1 ? 's' : ''}</span>` : ''}</h3>
        ${pend.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Fecha</th><th>Rol</th><th>Reporta a</th><th></th></tr></thead><tbody>${pend.map(u => `<tr><td><b>${esc(u.nombre)}</b></td><td>${esc(u.usuario)}</td><td>${esc(u.email)}</td><td>${fecha(u.creado)}</td>
          <td><select class="inp" style="padding:4px 8px" data-prol="${esc(u.usuario)}">${opRol('consulta')}</select></td><td><select class="inp" style="padding:4px 8px" data-pjefe="${esc(u.usuario)}">${opJefe(me, u.usuario)}</select></td>
          <td class="right" style="white-space:nowrap"><button class="btn pri sm" data-ok="${esc(u.usuario)}">Aprobar</button> <button class="btn sm ghost" data-no="${esc(u.usuario)}">Rechazar</button></td></tr>`).join('')}</tbody></table></div><div class="note">Al aprobar o rechazar, a la persona le llega un correo.</div>`
          : '<div class="muted">No hay solicitudes pendientes. Las personas piden acceso desde la pantalla de ingreso con "Solicitar acceso".</div>'}
        ${rech.length ? `<details class="mt"><summary class="muted" style="cursor:pointer">${rech.length} rechazada${rech.length > 1 ? 's' : ''}</summary><div class="note">${rech.map(u => `${esc(u.nombre)} (${esc(u.usuario)}, ${esc(u.email)}) <button class="btn sm ghost" data-ok="${esc(u.usuario)}">Aprobar de todos modos</button>`).join('<br>')}</div></details>` : ''}</div>`;
      box.innerHTML = pendHtml + `<div class="grid g2" style="gap:14px;align-items:start">
          <div class="card" style="padding:14px"><h3 style="margin:0 0 8px">Jerarquía</h3>${arbol('', 0) || '<div class="muted">Sin usuarios</div>'}</div>
          <div class="card" style="padding:14px"><h3 style="margin:0 0 8px">Qué puede hacer cada rol</h3><div class="note" style="line-height:1.7">
            <b>Administración:</b> todo, más crear usuarios y asignar roles.<br><b>Gerencia:</b> ver todo, cargar y borrar meses, cambiar los supuestos de la meta, descargar Excel y presentaciones.<br><b>Analista:</b> ver todo, cargar meses y descargar. No borra meses ni cambia supuestos.<br><b>Consulta:</b> solo totales y gráficas del historial, sin detalle por cliente ni descargas.</div></div></div>
        <div class="tbl-wrap mt"><table class="t"><thead><tr><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Rol</th><th>Reporta a</th><th>Estado</th><th></th></tr></thead><tbody>${usuarios.map(u => `<tr><td><b>${esc(u.usuario)}</b></td><td>${esc(u.nombre)}</td><td><input class="inp" style="padding:4px 8px;min-width:170px" type="email" placeholder="sin correo" value="${esc(u.email)}" data-mail="${esc(u.usuario)}"></td>
          <td>${u.usuario === me ? ROL_NOMBRE[u.rol] : `<select class="inp" style="padding:4px 8px" data-rol="${esc(u.usuario)}">${opRol(u.rol)}</select>`}</td>
          <td><select class="inp" style="padding:4px 8px" data-jefe="${esc(u.usuario)}">${opJefe(u.jefe, u.usuario)}</select></td>
          <td>${u.activo ? '<span class="chip up">activo</span>' : '<span class="chip down">inactivo</span>'}</td>
          <td class="right">${u.usuario === me ? '' : `<button class="btn sm ghost" data-act="${esc(u.usuario)}" data-on="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('')}</tbody></table></div>
        <form id="nuF" class="mt" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;align-items:end">
          <input class="inp" id="nuU" placeholder="usuario" autocomplete="off" autocapitalize="none"><input class="inp" id="nuN" placeholder="Nombre"><input class="inp" id="nuE" type="email" placeholder="Correo (opcional)" autocapitalize="none">
          <select class="inp" id="nuR">${opRol('consulta')}</select><select class="inp" id="nuJ">${opJefe(me, '')}</select>
          <input class="inp" id="nuP" type="password" placeholder="Contraseña temporal" autocomplete="new-password"><button class="btn pri sm" type="submit">Agregar usuario</button></form>
        <div class="note">La persona entra con la contraseña temporal y el sistema le pide cambiarla.</div>`;
      const upd = async (body, msg) => { try { await gsPost(Object.assign({ action: 'updateUser' }, body)); toast(msg); } catch (e) { toast(e.message, 5000); } renderUsuarios(); };
      $$('[data-rol]', box).forEach(x => x.onchange = () => upd({ usuario: x.dataset.rol, rol: x.value }, 'Rol actualizado'));
      $$('[data-jefe]', box).forEach(x => x.onchange = () => upd({ usuario: x.dataset.jefe, jefe: x.value }, 'Jerarquía actualizada'));
      $$('[data-mail]', box).forEach(x => x.onchange = () => upd({ usuario: x.dataset.mail, email: x.value.trim() }, 'Correo actualizado'));
      $$('[data-ok]', box).forEach(b => b.onclick = async () => {
        const u = b.dataset.ok, rs = box.querySelector(`[data-prol="${u}"]`), js = box.querySelector(`[data-pjefe="${u}"]`);
        b.disabled = true; try { const r = await gsPost({ action: 'approveUser', usuario: u, rol: rs ? rs.value : 'consulta', jefe: js ? js.value : '', appUrl: APP }); toast(r.correo ? 'Aprobado. Se le envió un correo.' : 'Aprobado (no se pudo enviar el correo).', 5000); } catch (e) { toast(e.message, 5000); } renderUsuarios();
      });
      $$('[data-no]', box).forEach(b => b.onclick = async () => {
        const tr = b.closest('tr'); if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = '¿Seguro? Rechazar'; tr.insertAdjacentHTML('afterend', `<tr class="motivo"><td colspan="7"><input class="inp" style="width:100%" placeholder="Motivo (opcional, se incluye en el correo)" data-motivo="${esc(b.dataset.no)}"></td></tr>`); return; }
        const mi = box.querySelector(`[data-motivo="${b.dataset.no}"]`);
        b.disabled = true; try { const r = await gsPost({ action: 'rejectUser', usuario: b.dataset.no, motivo: mi ? mi.value.trim() : '' }); toast(r.correo ? 'Rechazado. Se le envió un correo.' : 'Rechazado (no se pudo enviar el correo).', 5000); } catch (e) { toast(e.message, 5000); } renderUsuarios();
      });
      $$('[data-act]', box).forEach(b => b.onclick = () => upd({ usuario: b.dataset.act, activo: b.dataset.on === '1' }, b.dataset.on === '1' ? 'Usuario activado' : 'Usuario desactivado'));
      $('#nuF', box).onsubmit = async e => { e.preventDefault(); try { await gsPost({ action: 'addUser', usuario: $('#nuU', box).value.trim().toLowerCase(), nombre: $('#nuN', box).value.trim(), rol: $('#nuR', box).value, jefe: $('#nuJ', box).value, email: $('#nuE', box).value.trim(), password: $('#nuP', box).value, appUrl: APP }); toast('Usuario agregado'); renderUsuarios(); } catch (er) { toast(er.message, 5000); } };
    } catch (e) { box.innerHTML = `<div class="card"><div class="note" style="color:#f87171">No se pudieron cargar los usuarios: ${esc(e.message === 'timeout' ? 'Google tardó demasiado en responder' : e.message)}</div><button class="btn sm mt" id="usrRetry">Reintentar</button></div>`; $('#usrRetry').onclick = () => renderUsuarios(); }
  }
}

  function renderCargar() {
    const v = $('#v-cargar'); const reps = reports(); const have = new Set(reps.map(r => r.key));
    v.innerHTML = `<div class="vhead"><div><h2>Cargar reportes del mes</h2><p>Selecciona todos los Excel del cierre a la vez. El dashboard reconoce cada reporte por su código, detecta el mes y guarda los totales en tu historial. El detalle de clientes se procesa solo en tu navegador y no se guarda.</p></div></div>
      <div class="drop" id="drop"><div class="big"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg></div><h3>Toca para elegir los archivos o arrástralos aquí</h3><div class="muted">.XLS del SIF y feci.xls · todos juntos o la carpeta completa · también puedes soltarlos en cualquier pestaña</div></div>
      <div class="card mt"><h3>Reportes que entiende el dashboard <small>${S.current ? esc(C.monthLabel(S.current)) : ''}</small></h3><div class="replist">${C.REPORTS.map(r => `<div class="rep ${have.has(r.key) ? 'ok' : ''}"><span class="dot"></span><div class="nm"><b>${esc(r.name)}</b><span>${r.code === 'feci' ? 'feci_AAAAMMDD.xls' : esc(r.code)}${r.core ? ' · clave' : ''}</span></div></div>`).join('')}</div>
        <div class="note">Los marcados como "clave" son los necesarios para el Excel GSF y la morosidad. Si falta alguno, el resto del dashboard sigue funcionando con lo que haya.</div></div>
      <div class="card mt" id="gsCard"><h3>Base de datos en Google Sheets <small>${gsOn() ? (S.gsStatus === 'ok' ? '<span class="chip up">conectado</span>' : S.gsStatus ? '<span class="chip down">sin conexión</span>' : 'configurado') : 'opcional'}</small></h3>
        <div class="note" style="margin:-4px 0 12px">Guarda el historial en una hoja de Google tuya, para verlo desde cualquier equipo. ${window.claude ? '<b style="color:#fbbf24">Dentro de Claude el navegador bloquea conexiones externas: esto funciona cuando abres el dashboard desde Vercel o como archivo.</b>' : ''}</div>
        <div class="grid g2" style="gap:10px">
          <label class="ctrl" style="gap:4px"><span class="muted" style="font-size:12px">URL de la aplicación web (termina en /exec)${GS_FIXED ? ' · fija en index.html' : ''}</span><input class="inp" id="gsUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(gsCfg().url)}" ${GS_FIXED ? 'readonly' : ''}></label>
          <div class="ctrl" style="gap:4px"><span class="muted" style="font-size:12px">Sesión</span><div style="padding:9px 0">${gsOn() && gsCfg().me ? `<b>${esc(gsCfg().me.nombre || gsCfg().me.usuario)}</b> <span class="muted">(${esc(gsCfg().me.usuario)} · ${esc(ROL_NOMBRE[gsCfg().me.rol] || 'Administración')})</span>` : '<span class="muted">sin iniciar</span>'}</div></div>
        </div>
        <div class="note" style="margin-top:10px">Cada mes se guarda completo: totales, detalle por cliente y los reportes originales del SIF. Así cualquier usuario con permiso puede reabrirlo, descargar los reportes y sacar el Excel GSF, las letras y la presentación sin volver a subirlos.</div>
        <div class="tools mt"><button class="btn pri sm" id="gsSave">${gsOn() ? 'Probar conexión' : 'Conectar e iniciar sesión'}</button>${gsOn() ? '<button class="btn sm" id="gsPw">Cambiar mi contraseña</button>' : ''}${puede('usuarios') && gsOn() ? '<button class="btn sm" id="gsUsers">Usuarios y jerarquía</button>' : ''}${puede('saveMonth') ? `<button class="btn sm" id="gsPush" ${gsOn() && months().length ? '' : 'disabled'}>Subir a Sheets los meses de este navegador</button>` : ''}${!gsOn() || puede('usuarios') ? '<button class="btn sm" id="gsCode">Descargar código Apps Script</button><button class="btn sm ghost" id="gsCopy">Copiar código</button>' : ''}${gsOn() ? '<button class="btn sm ghost" id="gsOff">Cerrar sesión</button>' : ''}</div>
        <div class="note" id="gsMsg">${S.gsStatus && S.gsStatus !== 'ok' ? esc(S.gsStatus) : ''}</div>
        <details class="mt"><summary style="cursor:pointer;font-weight:600">Cómo crear la hoja (5 minutos)</summary><ol class="note" style="line-height:1.7">
          <li>Con tu cuenta de Google (por ejemplo proyectosrapiprestamos), crea un Google Sheet nuevo llamado "Historial dashboard cartera".</li>
          <li>Abre <b>Extensiones → Apps Script</b>, borra lo que haya y pega el código (botón <i>Copiar código</i> o <i>Descargar</i>).</li>
          <li>Guarda el proyecto.</li>
          <li>Vuelve al Sheet y recarga: aparece el menú <b>Dashboard cartera → Instalar</b>. Acepta los permisos. Se crean las hojas Meses, Clientes, Modelo, Config, Usuarios y Sesiones.</li>
          <li>En Apps Script: <b>Implementar → Nueva implementación → Aplicación web</b>. Ejecutar como: <b>Yo</b>. Quién tiene acceso: <b>Cualquier usuario</b>. Copia la URL que termina en <code>/exec</code> y pégala en <code>index.html</code> (donde dice PEGAR_AQUI_LA_URL_DEL_APPS_SCRIPT) o en este campo.</li>
          <li>La primera vez que abras la página te pide <b>crear la cuenta de administración</b> (usuario y contraseña). Desde <b>Usuarios</b> puedes dar acceso a otras personas.</li>
        </ol><div class="note">Las contraseñas se guardan con sal y SHA-256 (1000 vueltas) en la hoja Usuarios; la sesión dura 30 días y tras 5 intentos fallidos hay que esperar 15 minutos. Si alguien olvida su contraseña: menú <b>Dashboard cartera → Permitir que un usuario cree una contraseña nueva</b>. Si cambias el código del Apps Script, usa <b>Implementar → Administrar implementaciones → Editar → Nueva versión</b> para que la URL siga igual.</div></details>
      </div>
      <div class="card mt"><h3>Historial guardado <small>${gsOn() && S.gsStatus === 'ok' ? 'en Google Sheets' : S.store ? 'en tu cuenta de Claude' : 'en este navegador'}</small></h3>
        <div class="note" style="margin:-4px 0 12px">${gsOn() && S.gsStatus === 'ok' ? 'Se guarda en tu hoja de Google "Historial dashboard cartera" (pestañas Meses, Clientes, Modelo y Archivos). Lo ves desde cualquier equipo con tu usuario.' : S.store ? 'Se guarda en el almacenamiento privado de tu cuenta de Claude: solo tú lo ves, en cualquier dispositivo donde abras este dashboard.' : 'Se guarda en el almacenamiento local de este navegador (localStorage), en este equipo. No se sube a ningún servidor: otro navegador o dispositivo tiene su propio historial, y si borras los datos del navegador se pierde. Usa Exportar / Importar para pasarlo de un equipo a otro.'} Solo guarda los totales de cada mes (cartera, mora, recaudo, meta, cosechas, totales por patrono y oficial) y el tramo de mora de cada número de contrato, que sirve para ver quién cambió de tramo de un mes a otro. Nunca guarda nombres de clientes, cédulas ni saldos por cliente.</div>
        <div class="tools"><button class="btn sm" id="histExp" ${months().length ? '' : 'disabled'}>Exportar historial (.json)</button><button class="btn sm" id="histImp">Importar historial</button><input type="file" id="histFile" accept=".json,application/json" hidden></div>
        <div id="histTbl"></div></div>`;
    const drop = $('#drop');
    drop.onclick = () => $('#fileIn').click();
    const ms = months().slice().reverse();
    $('#histTbl').innerHTML = ms.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Mes</th><th class="n">Cartera</th><th class="n">PAR30</th><th class="n">Recaudo</th><th>Detalle</th><th></th></tr></thead><tbody>${ms.map(m => { const h = S.history[m]; return `<tr><td><b>${esc(h.label)}</b></td><td class="n">${money0(h.kpi.cartera)}</td><td class="n">${pct(h.kpi.par30Pct)}</td><td class="n">${money0(h.kpi.recaudo)}</td><td>${S.models[m] ? '<span class="chip up">cargado</span>' : '<span class="muted">solo totales</span>'}</td><td class="right"><button class="btn sm ghost" data-go="${m}">Ver</button> ${puede('deleteMonth') ? `<button class="btn sm ghost" data-del="${m}">Borrar</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="muted">Todavía no hay meses guardados.</div>';
    const gsMsg = t => { const el = $('#gsMsg'); if (el) el.innerHTML = t; };
    $('#gsSave').onclick = async () => {
      const url = $('#gsUrl').value.trim();
      if (!okUrl(url)) { gsMsg('<span style="color:#f87171">Escribe la URL (/exec).</span>'); return; }
      const g = gsCfg(); if (url !== g.url) { g.url = url; g.token = ''; g.me = null; } gsRemember();
      if (!g.token) { location.reload(); return; }
      gsMsg('Probando conexión…');
      try {
        const p = await gsGet({ action: 'ping' }); const lst = await gsGet({ action: 'list' });
        (lst.meses || []).forEach(m => { S.history[m.month] = m.agg; S.gsDetalle[m.month] = m.detalle; });
        S.gsStatus = 'ok'; if (!S.current) S.current = months().slice(-1)[0] || null;
        toast(`Conectado a "${p.hoja}" · ${(lst.meses || []).length} meses en la hoja`, 5000); renderAll();
      } catch (e) { S.gsStatus = 'error: ' + e.message; gsMsg('<span style="color:#f87171">No se pudo conectar: ' + esc(e.message === 'SESION' ? 'la sesión venció, vuelve a entrar' : e.message) + '</span>'); }
    };
    $('#gsPw') && ($('#gsPw').onclick = () => changePwDialog(false).then(ok => ok && toast('Contraseña cambiada')));
    $('#gsUsers') && ($('#gsUsers').onclick = () => go('usuarios'));
    $('#gsPush') && ($('#gsPush').onclick = async () => {
      const ms = months(); let n = 0;
      try { for (const m of ms) { loader(true, `Subiendo ${C.monthLabel(m)} a Google Sheets…`, Math.round(100 * n / ms.length)); await gsSaveMonth(S.history[m], S.models[m] && !S.models[m].fromSheets ? S.models[m].model : null, S.models[m] && S.models[m].reports); n++; } loader(false); toast(`${n} meses subidos a Google Sheets`); renderAll(); }
      catch (e) { loader(false); toast('Error al subir: ' + e.message, 6000); }
    });
    const code = () => window.__APPS_SCRIPT__ || '';
    $('#gsCode') && ($('#gsCode').onclick = () => saveFile('Code.gs.txt', new Blob([code()], { type: 'text/plain' })));
    $('#gsCopy') && ($('#gsCopy').onclick = async () => { try { await navigator.clipboard.writeText(code()); toast('Código copiado'); } catch (e) { toast('No se pudo copiar; usa Descargar'); } });
    $('#gsOff') && ($('#gsOff').onclick = () => window.gsfLogout());
    $('#histExp').onclick = () => { const out = {}; months().forEach(m => out[m] = S.history[m]); saveFile(`Historial dashboard cartera ${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ tipo: 'historial-dashboard-cartera', v: 1, meses: out, config: S.config }, null, 1)], { type: 'application/json' })); };
    $('#histImp').onclick = () => $('#histFile').click();
    $('#histFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const j = JSON.parse(await f.text()); if (j.tipo !== 'historial-dashboard-cartera' || !j.meses) throw new Error('Ese archivo no es un historial del dashboard.'); let n = 0; for (const m in j.meses) { const h = j.meses[m]; if (h && h.month && h.kpi) { S.history[h.month] = h; await saveMonth(h); n++; } } if (j.config) { mergeConfig(j.config); saveConfig(); } S.current = months().slice(-1)[0]; renderAll(); toast(`${n} meses importados`); } catch (er) { toast('No se pudo importar: ' + er.message, 5000); } };
    $$('[data-go]', v).forEach(b => b.onclick = () => { S.current = b.dataset.go; go('resumen'); });
    $$('[data-del]', v).forEach(b => b.onclick = async () => { if (b.dataset.confirm) { await deleteMonth(b.dataset.del); if (!S.history[S.current]) S.current = months().slice(-1)[0] || null; renderAll(); toast('Mes borrado'); } else { b.dataset.confirm = 1; b.textContent = '¿Seguro?'; setTimeout(() => { b.textContent = 'Borrar'; delete b.dataset.confirm; }, 3000); } });
  }

  async function handleFiles(files) {
    if (!puede('saveMonth')) { toast('Tu rol solo permite consultar. Pide a Administración que te cambie el rol para cargar reportes.', 6000); return; }
    files = files.filter(f => /\.xlsx?$/i.test(f.name)); if (!files.length) return;
    loader(true, 'Leyendo reportes…', 5);
    try {
      await loadScript('xlsx');
      const out = [];
      for (let i = 0; i < files.length; i++) {
        loader(true, `Leyendo ${i + 1} de ${files.length}: ${files[i].name.slice(0, 40)}`, 5 + 80 * i / files.length);
        const buf = await files[i].arrayBuffer();
        await new Promise(r => setTimeout(r, 10));
        try { const rp = C.readReport(buf, files[i].name); rp.raw = buf; out.push(rp); } catch (e) { console.error(e); out.push({ key: null, filename: files[i].name, name: 'No se pudo leer', meta: {}, aoa: [], rows: [] }); }
      }
      const known = out.filter(r => r.key);
      if (!known.length) { loader(false); toast('No reconocí ningún reporte del SIF en esos archivos.', 5000); return; }
      const month = C.batchMonth(known);
      if (!month) { loader(false); toast('No pude detectar el mes de los reportes.', 5000); return; }
      // Si ya hay reportes del mismo mes en sesión, se combinan (el nuevo reemplaza al mismo tipo)
      const prev = S.models[month] ? S.models[month].reports : [];
      const merged = prev.filter(r => !out.some(n => n.key && n.key === r.key && !C.BY_KEY[r.key].multi)).concat(out);
      loader(true, 'Calculando indicadores…', 90);
      await new Promise(r => setTimeout(r, 10));
      const md = C.buildModel(merged.filter(r => r.key), S.config);
      md.month = month;
      const ag = C.aggregate(md, S.config);
      try { const rc = C.reconcile(merged.filter(r => r.key), md, ag); ag.cuadre = { total: rc.length, ok: rc.filter(x => x.ok).length, explicadas: rc.filter(x => !x.ok && x.nota).length }; } catch (e) { console.error(e); }
      S.models[month] = { model: md, reports: merged };
      S.history[month] = ag; S.current = month;
      const saved = await saveMonth(ag, md, merged);
      if (saved === 'sheets') S.saveErr = null;
      loader(false);
      const unk = out.filter(r => !r.key).length;
      const cq = ag.cuadre; toast(`${C.monthLabel(month)}: ${known.length} reportes leídos${unk ? `, ${unk} sin reconocer` : ''}.${cq ? ` Cuadre: ${cq.ok} de ${cq.total} exactos${cq.total - cq.ok - cq.explicadas ? `, ${cq.total - cq.ok - cq.explicadas} por revisar` : ''}.` : ''}${saved === 'sheets' ? ` Guardado completo en Google Sheets (detalle y ${merged.filter(r => r.raw).length} reportes originales).` : ''}`, 8000);
      renderAll(); go('resumen');
    } catch (e) { loader(false); console.error(e); toast('Error al leer: ' + e.message, 6000); }
  }

  // ---------- arrastrar y soltar en toda la página (archivos o carpetas) ----------
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  function readEntry(entry) {
    return new Promise(res => {
      if (!entry) return res([]);
      if (entry.isFile) entry.file(f => res([f]), () => res([]));
      else if (entry.isDirectory) {
        const rd = entry.createReader(); const all = [];
        const next = () => rd.readEntries(async ents => { if (!ents.length) { const nested = await Promise.all(all.map(readEntry)); res(nested.flat()); } else { all.push(...ents); next(); } }, () => res([]));
        next();
      } else res([]);
    });
  }
  async function filesFromDrop(dt) {
    const items = [...(dt.items || [])].filter(i => i.kind === 'file');
    const entries = items.map(i => i.webkitGetAsEntry ? i.webkitGetAsEntry() : null);
    if (entries.length && entries.every(Boolean)) { const lists = await Promise.all(entries.map(readEntry)); const out = lists.flat(); if (out.length) return out; }
    return [...(dt.files || [])];
  }
  document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  document.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', async e => {
    if (!e.dataTransfer) return; e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const files = await filesFromDrop(e.dataTransfer);
    const ok = files.filter(f => /\.xlsx?$/i.test(f.name));
    if (!ok.length) { toast(files.length ? 'Esos archivos no son Excel (.xls / .xlsx).' : 'No llegaron archivos. Prueba con el botón Cargar mes.', 5000); return; }
    handleFiles(ok);
  });

  // ---------- navegación ----------
  const VIEWS = { resumen: renderResumen, morosidad: renderMora, analisis: renderAnalisis, meta: renderMeta, ingresos: renderIngresos, excel: renderExcel, presentacion: renderPres, cuadre: renderCuadre, reportes: renderReportes, cargar: renderCargar, usuarios: renderUsuarios };
  const rendered = {};
  function go(tab) {
    if (!VIEWS[tab]) tab = 'resumen';
    S.tab = tab;
    if (location.hash !== '#' + tab) { try { history.replaceState(null, '', '#' + tab); } catch (e) { location.hash = tab; } }
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.v === tab));
    $$('section.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + tab));
    if (rendered[tab] !== S.current + '|' + renderStamp) { Object.keys(charts).forEach(id => { if (document.getElementById(id) && document.getElementById(id).closest('#v-' + tab)) { charts[id].dispose(); delete charts[id]; } }); VIEWS[tab](); rendered[tab] = S.current + '|' + renderStamp; }
    setTimeout(() => Object.entries(charts).forEach(([id, c]) => { const el = document.getElementById(id); if (el && el.offsetParent) c.resize(); }), 60);
    const a = $(`#tabs a[data-v="${tab}"]`); if (a && a.scrollIntoView) a.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
  let renderStamp = 0;
  const gsLoading = {};
  function renderAll() {
    renderStamp++; renderMonthSel(); go(S.tab);
    const ym = S.current;
    if (ym && !S.models[ym] && S.gsDetalle[ym] && gsOn() && puede('getModel') && !gsLoading[ym]) {
      gsLoading[ym] = true; loader(true, 'Trayendo el detalle de ' + C.monthLabel(ym) + ' desde Google Sheets…', 50);
      gsLoadModel(ym).then(md => { loader(false); if (md) { S.models[ym] = { model: md, reports: [], fromSheets: true }; if (S.current === ym) renderAll(); } })
        .catch(e => { loader(false); toast('No se pudo traer el detalle: ' + e.message, 6000); }).finally(() => { gsLoading[ym] = false; });
    }
  }
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  $$('#tabs a').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.v); });
  $('#monthSel').onchange = e => { S.current = e.target.value; renderAll(); };
  $('#btnUpload').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };

  // ---------- acceso: usuario y contraseña (los valida el Apps Script; fuera de Claude) ----------
  const CUBE = '<div class="cube" style="width:46px;height:46px;margin:0 auto 14px"><div class="c"><div class="f"></div><div class="f"></div><div class="f"></div><div class="f"></div><div class="f"></div><div class="f"></div></div></div>';
  const red = t => '<span style="color:#f87171">' + esc(t) + '</span>';
  function modal(inner) { const el = document.createElement('div'); el.className = 'lock'; el.innerHTML = `<div class="card lockbox">${CUBE}<h2 style="text-align:center">Cartera GSF · Dashboard</h2>${inner}</div>`; document.body.appendChild(el); return el; }
  function changePwDialog(forced) {
    return new Promise(resolve => {
      const el = modal(`<p class="muted" style="text-align:center;margin:6px 0 18px">${forced ? 'Tu contraseña es temporal: crea una nueva para continuar.' : 'Cambiar mi contraseña'}</p>
        <form id="cpF" class="ctrl" style="gap:10px"><input class="inp" id="cpA" type="password" placeholder="Contraseña actual" autocomplete="current-password"><input class="inp" id="cpN" type="password" placeholder="Contraseña nueva (mínimo 8)" autocomplete="new-password"><input class="inp" id="cpN2" type="password" placeholder="Repite la nueva" autocomplete="new-password">
        <button class="btn pri" type="submit" style="justify-content:center">Guardar</button>${forced ? '' : '<button type="button" class="btn sm ghost" id="cpX" style="justify-content:center">Cancelar</button>'}<div class="note" id="cpM" style="text-align:center;min-height:18px"></div></form>`);
      const msg = t => $('#cpM', el).innerHTML = t;
      $('#cpX', el) && ($('#cpX', el).onclick = () => { el.remove(); resolve(false); });
      $('#cpF', el).onsubmit = async e => {
        e.preventDefault(); const n = $('#cpN', el).value;
        if (n.length < 8) return msg(red('Usa al menos 8 caracteres.'));
        if (n !== $('#cpN2', el).value) return msg(red('Las contraseñas no coinciden.'));
        msg('Guardando…');
        try { await gsPost({ action: 'changePassword', actual: $('#cpA', el).value, nueva: n }); el.remove(); resolve(true); } catch (er) { msg(red(er.message)); }
      };
    });
  }
  function lockScreen() {
    return new Promise(resolve => {
      const g = gsCfg(), askUrl = !g.url;
      const el = modal(`<p class="muted" id="lkT" style="text-align:center;margin:6px 0 18px">Inicia sesión para entrar.</p>
        <form id="lkF" class="ctrl" style="gap:10px">
          <input class="inp" id="lkUrl" placeholder="URL de la aplicación web de Apps Script (…/exec)" style="${askUrl ? '' : 'display:none'}" value="${esc(g.url)}">
          <input class="inp" id="lkNom" placeholder="Tu nombre completo" style="display:none" autocomplete="name">
          <input class="inp" id="lkMail" type="email" placeholder="Tu correo" style="display:none" autocomplete="email" autocapitalize="none">
          <input class="inp" id="lkU" placeholder="Usuario" autocomplete="username" autocapitalize="none" autofocus>
          <input class="inp" id="lkP" type="password" placeholder="Contraseña" autocomplete="current-password">
          <input class="inp" id="lkP2" type="password" placeholder="Repite la contraseña" autocomplete="new-password" style="display:none">
          <button class="btn pri" id="lkB" type="submit" style="justify-content:center">Entrar</button>
          <div class="note" id="lkM" style="text-align:center;min-height:18px"></div>
          <button type="button" class="btn sm ghost" id="lkReg" style="justify-content:center;display:none">¿No tienes cuenta? Solicitar acceso</button>
          ${GS_FIXED ? '' : `<button type="button" class="btn sm ghost" id="lkChg" style="justify-content:center;${askUrl ? 'display:none' : ''}">Usar otra base de datos</button>`}
        </form>`);
      const msg = t => $('#lkM', el).innerHTML = t;
      let mode = 'login';
      const setMode = m => {
        mode = m; const creating = m === 'setup' || m === 'crear' || m === 'registro';
        $('#lkNom', el).style.display = m === 'setup' || m === 'registro' ? '' : 'none';
        $('#lkMail', el).style.display = m === 'setup' || m === 'registro' ? '' : 'none';
        $('#lkReg', el).style.display = m === 'login' || m === 'registro' ? '' : 'none';
        $('#lkReg', el).textContent = m === 'registro' ? 'Ya tengo cuenta: iniciar sesión' : '¿No tienes cuenta? Solicitar acceso';
        $('#lkP2', el).style.display = creating ? '' : 'none';
        $('#lkP', el).autocomplete = creating ? 'new-password' : 'current-password';
        $('#lkT', el).textContent = m === 'setup' ? 'Primera vez: crea la cuenta de administración (contraseña de mínimo 8 caracteres).' : m === 'crear' ? 'Crea tu contraseña nueva (mínimo 8 caracteres).' : m === 'registro' ? 'Solicita acceso. Administración debe aprobarte; te llegará un correo.' : 'Inicia sesión para entrar.';
        $('#lkB', el).textContent = m === 'setup' ? 'Crear cuenta y entrar' : m === 'crear' ? 'Crear contraseña y entrar' : m === 'registro' ? 'Enviar solicitud' : 'Entrar';
        $('#lkU', el).placeholder = m === 'registro' ? 'Elige un usuario (ej. maria.perez)' : 'Usuario';
        msg('');
      };
      const probe = async () => {
        $('#lkB', el).disabled = true; $('#lkT', el).textContent = 'Conectando…';
        try { const st = await gsCall({ action: 'setupStatus' }, 30000); if (st.necesitaConfiguracion) setMode('setup'); else if (mode !== 'registro') setMode('login'); } catch (e) { setMode('login'); msg(red('No se pudo conectar con Apps Script: ' + e.message)); }
        $('#lkB', el).disabled = false;
      };
      $('#lkReg', el).onclick = () => setMode(mode === 'registro' ? 'login' : 'registro');
      $('#lkChg', el) && ($('#lkChg', el).onclick = () => { $('#lkUrl', el).style.display = ''; $('#lkUrl', el).focus(); });
      $('#lkUrl', el).onchange = () => { const u = $('#lkUrl', el).value.trim(); if (okUrl(u)) { g.url = u; gsRemember(); probe(); } };
      $('#lkF', el).onsubmit = async e => {
        e.preventDefault();
        const url = $('#lkUrl', el).value.trim(), usuario = $('#lkU', el).value.trim().toLowerCase(), pw = $('#lkP', el).value;
        if (!okUrl(url)) return msg(red('Falta la URL de Apps Script.'));
        if (!usuario || !pw) return msg(red('Escribe tu usuario y contraseña.'));
        if (url !== g.url) { g.url = url; gsRemember(); }
        if (mode !== 'login') {
          if (pw.length < 8) return msg(red('Usa al menos 8 caracteres.'));
          if (pw !== $('#lkP2', el).value) return msg(red('Las contraseñas no coinciden.'));
        }
        if (mode === 'registro' || mode === 'setup') {
          if (!$('#lkNom', el).value.trim()) return msg(red('Escribe tu nombre.'));
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('#lkMail', el).value.trim())) return msg(red('Escribe un correo válido.'));
        }
        msg(mode === 'registro' ? 'Enviando solicitud…' : 'Verificando…');
        if (mode === 'registro') {
          try {
            await gsCall({ action: 'register', usuario, nombre: $('#lkNom', el).value.trim(), email: $('#lkMail', el).value.trim(), password: pw, appUrl: (location.origin + location.pathname) });
            ['#lkP', '#lkP2'].forEach(k => $(k, el).value = ''); setMode('login'); $('#lkU', el).value = usuario;
            msg('<span style="color:#34d399">Solicitud enviada. Te llegará un correo cuando Administración la apruebe.</span>');
          } catch (er) { msg(red(er.message)); }
          return;
        }
        try {
          if (mode === 'setup') await gsCall({ action: 'setupAdmin', usuario, nombre: $('#lkNom', el).value.trim(), email: $('#lkMail', el).value.trim(), password: pw });
          if (mode === 'crear') await gsCall({ action: 'createPassword', usuario, password: pw });
          const d = await gsCall({ action: 'login', usuario, password: pw });
          g.token = d.token; g.me = d.me; gsRemember();
          if (d.debeCambiar) { el.style.display = 'none'; await changePwDialog(true); }
          S.gsStatus = 'ok'; el.remove(); resolve();
        } catch (er) {
          if (er.message === 'CREAR_CLAVE') { setMode('crear'); msg('Tu contraseña fue restablecida: crea una nueva.'); return; }
          msg(red(er.message));
        }
      };
      if (!askUrl) probe();
    });
  }
  async function needsLock() {
    if (window.claude) return false; // dentro de Claude el artifact ya es privado y no puede salir a Google
    const g = gsCfg();
    if (g.url && g.token) {
      try { const p = await gsGet({ action: 'ping' }); g.me = p.me; gsRemember(); S.gsStatus = 'ok'; S.pendientes = p.pendientes || 0; return false; }
      catch (e) { if (e.message === 'DEBE_CAMBIAR') { await changePwDialog(true); S.gsStatus = 'ok'; return false; } return true; }
    }
    return true;
  }
  window.gsfLogout = async () => { const g = gsCfg(); try { if (g.token) await gsCall({ action: 'logout' }, 10000); } catch (e) { } g.token = ''; g.me = null; gsRemember(); location.reload(); };

  // ---------- inicio ----------
  (async function init() {
    if (await needsLock()) await lockScreen();
    loadScript('xlsx').catch(() => { });
    try { await loadScript('echarts'); } catch (e) { toast(e.message, 8000); }
    await storeInit();
    S.current = months().slice(-1)[0] || null;
    const h = location.hash.slice(1); S.tab = VIEWS[h] ? h : 'resumen';
    renderAll();
    if (!window.claude && gsOn()) $('#btnLogout').style.display = '';
    aplicarPermisos();
    if (!window.claude && gsOn() && puede('usuarios')) gsGet({ action: 'ping' }).then(p => { S.pendientes = p.pendientes || 0; aplicarPermisos(); }).catch(() => { });
    capUse('downloads').then(d => S.downloads = d);
  })();
})();
