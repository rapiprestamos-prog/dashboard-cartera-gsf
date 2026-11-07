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
  const S = { config: JSON.parse(JSON.stringify(C.DEFAULT_CONFIG)), history: {}, models: {}, current: null, tab: 'resumen', moraMig: true, store: null, uid: null, downloads: null };
  const capUse = n => (window.claude && typeof window.claude.use === 'function') ? window.claude.use(n).catch(() => null) : Promise.resolve(null);

  // ---------- carga de librerías ----------
  const loaded = {};
  function loadScript(key) {
    if (loaded[key]) return loaded[key];
    loaded[key] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = LIBS[key]; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + key)); document.head.appendChild(s); });
    return loaded[key];
  }

  // ---------- almacenamiento ----------
  const LS = { get(k) { try { return JSON.parse(localStorage.getItem('gsfdash.' + k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem('gsfdash.' + k, JSON.stringify(v)); } catch (e) { } }, del(k) { try { localStorage.removeItem('gsfdash.' + k); } catch (e) { } } };
  async function storeInit() {
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
      if (S.store) { try { await S.store.collection('data/users/' + S.uid).doc('config').set(body); } catch (e) { } }
    }, 700);
  }
  async function saveMonth(agg) {
    const all = Object.assign({}, LS.get('history') || {}); all[agg.month] = agg; LS.set('history', all);
    if (S.store) { try { await S.store.collection('data/users/' + S.uid).doc('m' + agg.month.replace('-', '')).set(agg); return true; } catch (e) { toast('Guardado solo en este navegador (' + (e.code || 'error') + ').'); } }
    return false;
  }
  async function deleteMonth(ym) {
    delete S.history[ym]; delete S.models[ym];
    const all = LS.get('history') || {}; delete all[ym]; LS.set('history', all);
    if (S.store) { try { await S.store.collection('data/users/' + S.uid).doc('m' + ym.replace('-', '')).delete(); } catch (e) { } }
  }

  // ---------- utilidades UI ----------
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), ms || 3200); }
  function loader(on, tx, p) { $('#loader').classList.toggle('on', !!on); if (tx) $('#loaderTx').textContent = tx; if (p != null) $('#loaderBar').style.width = p + '%'; }
  const months = () => Object.keys(S.history).sort();
  const agg = () => S.history[S.current];
  const prevAgg = () => { const m = months(); const i = m.indexOf(S.current); return i > 0 ? S.history[m[i - 1]] : null; };
  const model = () => S.models[S.current] && S.models[S.current].model;
  const reports = () => (S.models[S.current] && S.models[S.current].reports) || [];
  const needDetail = (what) => `<div class="empty"><b>Falta el detalle de ${esc(C.monthLabel(S.current))}</b>${esc(what || 'Esta sección usa el detalle por cliente.')} Carga los reportes del mes con <b style="display:inline">Cargar mes</b>; se leen solo en tu navegador.</div>`;
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
    const mf = C.metaFromAgg(p || a, S.config.meta);
    const cumpl = mf.meta ? k.recaudo / mf.meta : 0;
    out.push({ t: cumpl >= 1 ? 'good' : cumpl >= .85 ? 'warn' : 'bad', x: `Se recaudaron ${money0(k.recaudo)} contra una meta ${p ? 'fijada al cierre anterior' : 'estimada'} de ${money0(mf.meta)}: cumplimiento ${pct(cumpl, 0)}.` });
    const r0 = a.metaRows && a.metaRows[0]; if (r0 && r0.cuotas) out.push({ t: r0.real / r0.cuotas >= .95 ? 'good' : 'warn', x: `Los clientes al día pagaron ${money0(r0.real)} de ${money0(r0.cuotas)} en cuotas programadas (${pct(r0.real / r0.cuotas, 0)}).` });
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
    out.push('Fijar la meta del próximo mes en ' + money0(C.metaFromAgg(a, S.config.meta).meta) + ' y darle seguimiento semanal por oficial.');
    return out;
  }

  // ---------- render: selector de mes ----------
  function renderMonthSel() {
    const sel = $('#monthSel'); const m = months();
    sel.innerHTML = m.length ? m.slice().reverse().map(x => `<option value="${x}" ${x === S.current ? 'selected' : ''}>${C.monthLabel(x)}${S.models[x] ? '' : ''}</option>`).join('') : '<option>Sin datos</option>';
    const a = agg();
    $('#subtitle').textContent = a ? `Cierre ${a.label} · ${int(a.kpi.prestamos)} préstamos${S.models[S.current] ? ' · detalle cargado' : ''}` : 'Carga los reportes del mes';
  }

  // ---------- RESUMEN ----------
  const emptyCTA = () => `<div class="card empty" style="padding:56px 18px"><div class="drop" style="border:0;background:none;padding:0;cursor:default"><div class="big"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg></div></div><b>Sube los reportes del mes para empezar</b>El dashboard no trae datos: lee los Excel del SIF que cargues, arma los gráficos y genera el Excel GSF, el análisis y la presentación. Los archivos se procesan solo en tu navegador.<div class="mt"><button class="btn pri" onclick="document.getElementById('fileIn').click()">Cargar reportes</button></div></div>`;
  function renderResumen() {
    const v = $('#v-resumen'); const a = agg();
    if (!a) { v.innerHTML = emptyCTA(); return; }
    const p = prevAgg(), k = a.kpi, pk = p && p.kpi;
    const mf = C.metaFromAgg(p || a, S.config.meta); const cumpl = mf.meta ? k.recaudo / mf.meta : 0;
    v.innerHTML = `
      <div class="vhead"><div><h2>Resumen del cierre · ${esc(a.label)}</h2><p>Foto de la cartera activa al cierre: tamaño, calidad, cobros e ingresos del mes.</p></div></div>
      <div class="grid g-kpi">
        ${kpiCard('Cartera total', short(k.cartera), `${int(k.prestamos)} préstamos ${delta(k.cartera, pk && pk.cartera)}`, '#38bdf8')}
        ${kpiCard('PAR30', pct(k.par30Pct), `${short(k.par30)} en riesgo ${delta(k.par30Pct, pk && pk.par30Pct, { pp: true, inverse: true })}`, '#f87171')}
        ${kpiCard('PAR30 sin migrados', pct(k.par30NMPct), `sobre ${short(k.carteraNM)}`, '#fb923c')}
        ${kpiCard('Saldo moroso', short(k.moroso), `${pct(k.morosoPct)} de la cartera`, '#e11d48')}
        ${kpiCard('Recaudo del mes', short(k.recaudo), `<span class="chip ${cumpl >= 1 ? 'up' : cumpl >= .85 ? 'warn' : 'down'}">${pct(cumpl, 0)} de la meta</span> ${delta(k.recaudo, pk && pk.recaudo)}`, '#34d399')}
        ${kpiCard('Intereses + GM del mes', short(k.interesesMes + k.gmMes), `Int ${short(k.interesesMes)} · GM ${short(k.gmMes)}`, '#818cf8')}
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

  // ---------- META DE COBROS ----------
  function renderMeta() {
    const v = $('#v-meta'); const a = agg(); if (!a) { v.innerHTML = emptyCTA(); return; }
    const p = prevAgg(); const md = model(); const cfg = S.config.meta;
    const base = p || a; const mf = C.metaFromAgg(base, cfg); const next = C.metaFromAgg(a, cfg);
    const real = a.kpi.recaudo; const cumpl = mf.meta ? real / mf.meta : 0;
    const thr = [30, 60, 90, 120, 365];
    v.innerHTML = `
      <div class="vhead"><div><h2>Meta de cobros</h2><p>La meta junta dos partes: las cuotas del mes de los préstamos que siguen pagando y un % de recuperación de lo vencido por tramo. Ajusta los supuestos y todo se recalcula.</p></div></div>
      <div class="grid g12">
        <div class="card ctrl" id="metaCtrl">
          <h3>Supuestos de la meta</h3>
          <div class="slider"><label>Cobrar cuotas de préstamos hasta</label><output id="oThr">${cfg.cuotaHastaDias >= 365 ? '365' : cfg.cuotaHastaDias} días</output><input type="range" id="sThr" min="0" max="4" step="1" value="${Math.max(0, thr.indexOf(cfg.cuotaHastaDias))}"></div>
          <div class="slider"><label>Efectividad esperada en cuotas</label><output id="oEf">${cfg.efectividadCuotas}%</output><input type="range" id="sEf" min="50" max="100" step="1" value="${cfg.efectividadCuotas}"></div>
          ${C.BUCKETS.slice(1).map((b, i) => `<div class="slider"><label>Recuperar del vencido ${b} días</label><output id="oR${i + 1}">${cfg.recupera[i + 1]}%</output><input type="range" data-b="${i + 1}" class="sR" min="0" max="${i + 1 >= 4 ? 20 : 100}" step="${i + 1 >= 5 ? 0.25 : 1}" value="${cfg.recupera[i + 1]}"></div>`).join('')}
          <button class="btn sm ghost" id="metaReset">Volver a los valores sugeridos</button>
          <div class="note">Se guarda para los próximos meses. ${p ? `El cumplimiento de ${esc(a.label)} se mide contra la meta calculada con el cierre de ${esc(p.label)}.` : `Como no hay mes anterior, la meta de ${esc(a.label)} se estima con este mismo cierre.`}</div>
        </div>
        <div class="grid" style="gap:14px">
          <div class="grid g-kpi">
            ${kpiCard('Meta ' + esc(a.label), short(mf.meta), `Cuotas ${short(mf.metaCuotas)} · Recup. ${short(mf.metaRecup)}`, '#818cf8')}
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
      <div class="card mt"><h3>Lista de cobro <small>quién debía pagar y cuánto falta</small></h3><div id="cobroTbl">${md ? '' : needDetail('La lista de cobro por cliente usa los reportes del mes.')}</div></div>`;
    enableTilt(v);
    const upd = () => { saveConfig(); renderStamp++; Object.keys(rendered).forEach(k => rendered[k] = null); rendered.meta = S.current + '|' + renderStamp; renderMeta(); };
    $('#sThr').oninput = e => { cfg.cuotaHastaDias = thr[+e.target.value]; $('#oThr').textContent = cfg.cuotaHastaDias + ' días'; };
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
      series: [{ name: 'Meta cuotas', type: 'bar', stack: 'm', data: mr.map(r => r.metaCuotas), itemStyle: { color: '#6366f1' }, barWidth: 22 }, { name: 'Meta recuperación', type: 'bar', stack: 'm', data: mr.map(r => r.metaRecup), itemStyle: { color: '#a78bfa', borderRadius: [6, 6, 0, 0] } }, { name: 'Cobrado', type: 'bar', data: realB, itemStyle: { color: grad('#34d399', '#065f46'), borderRadius: [6, 6, 0, 0] }, barWidth: 22 }] });
    if (md) {
      const per = C.computeMeta(md.loans, cfg).perLoan;
      const om = new Map(); md.loans.forEach(l => { const g = om.get(l.oficial) || { k: l.oficial, meta: 0, real: 0 }; g.meta += per.get(l.id) || 0; g.real += l.pagadoMes; om.set(l.oficial, g); });
      const ofs = [...om.values()].sort((x, y) => y.meta - x.meta);
      chart('cMetaO', { tooltip: tip({ valueFormatter: v => money0(v) }), legend: { top: 0, textStyle: { color: '#9fb0d8' } }, grid: { left: 60, right: 14, top: 36, bottom: 30 }, xAxis: Object.assign({ type: 'category', data: ofs.map(o => o.k) }, axisStyle), yAxis: { type: 'value', axisLabel: { color: '#9fb0d8', formatter: v => short(v) }, splitLine: axisStyle.splitLine },
        series: [{ name: 'Meta', type: 'bar', data: ofs.map(o => Math.round(o.meta)), itemStyle: { color: grad('#818cf8', '#312e81'), borderRadius: [6, 6, 0, 0] }, barWidth: 24 }, { name: 'Cobrado', type: 'bar', data: ofs.map(o => Math.round(o.real)), itemStyle: { color: grad('#34d399', '#065f46'), borderRadius: [6, 6, 0, 0] }, barWidth: 24, label: { show: true, position: 'top', color: '#e8eeff', fontSize: 10.5, formatter: p => { const o = ofs[p.dataIndex]; return o.meta ? pct(o.real / o.meta, 0) : ''; } } }] });
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
      { h: 'Saldo moroso', v: r => r.moroso, n: 1, f: money, sum: 1 }, { h: 'Meta cuotas', v: r => r.metaCuotas, n: 1, f: money, sum: 1 }, { h: 'Meta recuperación', v: r => r.metaRecup, n: 1, f: money, sum: 1 },
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
          <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="gsfRes" checked> Agregar hoja "Resumen" por clasificación y patrono</label>
          <button class="btn pri" id="dlGsf"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>GSF - Cartera Cierre ${esc(fileMonth(md.month))}.xlsx</button>
          <button class="btn" id="dlAna">Análisis completo del mes (.xlsx)</button>
          <div class="note">El análisis trae hojas por tramo, producto, patrono, oficial, meta y la lista de cobro.</div>
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
    $('#dlGsf').onclick = () => downloadGSF($('#gsfRes').checked);
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
    if (!S.downloads) S.downloads = await capUse('downloads');
    if (S.downloads) {
      try { await S.downloads.save({ filename, data: blob }); toast('Listo: ' + filename); return; }
      catch (e) { if (e && e.code === 'declined') { toast('Descarga cancelada'); return; } if (e && e.code === 'rate_limited') { toast('Espera un momento y vuelve a intentar'); return; } toast('No se pudo descargar (' + (e && e.code || 'error') + ')'); return; }
    }
    if (!window.claude) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return; }
    toast('Las descargas no están disponibles en esta vista. Abre el dashboard en claude.ai.');
  }
  async function downloadGSF(resumen) {
    const md = model(); if (!md) return;
    loader(true, 'Armando el Excel GSF…', 30);
    try {
      await loadScript('exceljs');
      const cierre = reports().find(r => r.key === 'cierre');
      const wb = await Exporters.gsfWorkbook(md, S.config, { resumen, cierreMeta: { printed: cierre && cierre.meta.printedRaw } });
      loader(true, 'Generando archivo…', 80);
      const buf = await wb.xlsx.writeBuffer();
      loader(false);
      await saveFile(`GSF - Cartera Cierre ${fileMonth(md.month)}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (e) { loader(false); console.error(e); toast('Error al generar el Excel: ' + e.message); }
  }
  async function downloadAnalysis() {
    const md = model(); const a = agg(); if (!a) return;
    loader(true, 'Armando el análisis…', 30);
    try {
      await loadScript('exceljs');
      const wb = await Exporters.analysisWorkbook(md, a, S.config);
      const buf = await wb.xlsx.writeBuffer(); loader(false);
      await saveFile(`Analisis de cartera ${a.label}.xlsx`, new Blob([buf]));
    } catch (e) { loader(false); console.error(e); toast('Error: ' + e.message); }
  }

  // ---------- PRESENTACIÓN ----------
  let slideIx = 0;
  function slidesData() {
    const a = agg(), p = prevAgg(), k = a.kpi, mf = C.metaFromAgg(p || a, S.config.meta);
    return { a, p, k, mf, cumpl: mf.meta ? k.recaudo / mf.meta : 0, ins: insights(a, p), rec: recomendaciones(a), next: C.metaFromAgg(a, S.config.meta) };
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
      ...(hist ? [`<div class="slide"><div class="band">Evolución mensual<small>cartera, recaudo y PAR30</small></div><div class="body"><div id="sP6" class="schart"></div></div>${foot(7)}</div>`] : []),
      `<div class="slide"><div class="band">Hallazgos</div><div class="body"><ul class="slist">${D.ins.slice(0, 6).map(i => `<li>${esc(i.x)}</li>`).join('')}</ul></div>${foot(hist ? 8 : 7)}</div>`,
      `<div class="slide"><div class="band">Recomendaciones y próximos pasos</div><div class="body"><ul class="slist">${D.rec.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>${foot(hist ? 9 : 8)}</div>`
    ];
    slideIx = Math.min(slideIx, slides.length - 1);
    v.innerHTML = `
      <div class="vhead"><div><h2>Presentación gerencial</h2><p>Se arma sola con los datos del mes. Preséntala aquí en pantalla completa o descárgala en PowerPoint con gráficos editables.</p></div>
        <div class="tools" style="margin:0"><button class="btn" id="fsBtn">Pantalla completa</button><button class="btn pri" id="pptBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>PowerPoint</button></div></div>
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
  function renderReportes() {
    const v = $('#v-reportes'); const reps = reports();
    v.innerHTML = `<div class="vhead"><div><h2>Ver reportes</h2><p>Los Excel tal como vienen del SIF. Ábrelos solo si quieres revisar el original; el dashboard ya los tiene leídos.</p></div></div>
      ${reps.length ? `<div class="replist" id="repList">${reps.map((r, i) => `<div class="rep ${r.key ? 'ok' : ''}"><span class="dot"></span><div class="nm"><b title="${esc(r.filename)}">${esc(r.name)}</b><span>${int(r.rows.length)} filas de detalle · ${esc(r.filename.replace(/^[0-9a-f]{8}-/, ''))}</span></div><button class="btn sm" data-i="${i}">Ver</button></div>`).join('')}</div><div class="card mt" id="repView" style="display:none"></div>` : `<div class="card">${needDetail('Aquí puedes abrir cada Excel original.')}</div>`}`;
    $$('#repList button').forEach(b => b.onclick = () => {
      const r = reps[+b.dataset.i]; const box = $('#repView');
      if (box.dataset.i === b.dataset.i && box.style.display !== 'none') { box.style.display = 'none'; b.textContent = 'Ver'; return; }
      $$('#repList button').forEach(x => x.textContent = 'Ver'); b.textContent = 'Ocultar';
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
  function renderCargar() {
    const v = $('#v-cargar'); const reps = reports(); const have = new Set(reps.map(r => r.key));
    v.innerHTML = `<div class="vhead"><div><h2>Cargar reportes del mes</h2><p>Selecciona todos los Excel del cierre a la vez. El dashboard reconoce cada reporte por su código, detecta el mes y guarda los totales en tu historial. El detalle de clientes se procesa solo en tu navegador y no se guarda.</p></div></div>
      <div class="drop" id="drop"><div class="big"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg></div><h3>Toca para elegir los archivos o arrástralos aquí</h3><div class="muted">.XLS del SIF y feci.xls · puedes subirlos todos juntos</div></div>
      <div class="card mt"><h3>Reportes que entiende el dashboard <small>${S.current ? esc(C.monthLabel(S.current)) : ''}</small></h3><div class="replist">${C.REPORTS.map(r => `<div class="rep ${have.has(r.key) ? 'ok' : ''}"><span class="dot"></span><div class="nm"><b>${esc(r.name)}</b><span>${r.code === 'feci' ? 'feci_AAAAMMDD.xls' : esc(r.code)}${r.core ? ' · clave' : ''}</span></div></div>`).join('')}</div>
        <div class="note">Los marcados como "clave" son los necesarios para el Excel GSF y la morosidad. Si falta alguno, el resto del dashboard sigue funcionando con lo que haya.</div></div>
      <div class="card mt"><h3>Historial guardado <small>${S.store ? 'en tu cuenta' : 'en este navegador'}</small></h3><div id="histTbl"></div></div>`;
    const drop = $('#drop');
    drop.onclick = () => $('#fileIn').click();
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => handleFiles([...e.dataTransfer.files]));
    const ms = months().slice().reverse();
    $('#histTbl').innerHTML = ms.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Mes</th><th class="n">Cartera</th><th class="n">PAR30</th><th class="n">Recaudo</th><th>Detalle</th><th></th></tr></thead><tbody>${ms.map(m => { const h = S.history[m]; return `<tr><td><b>${esc(h.label)}</b></td><td class="n">${money0(h.kpi.cartera)}</td><td class="n">${pct(h.kpi.par30Pct)}</td><td class="n">${money0(h.kpi.recaudo)}</td><td>${S.models[m] ? '<span class="chip up">cargado</span>' : '<span class="muted">solo totales</span>'}</td><td class="right"><button class="btn sm ghost" data-go="${m}">Ver</button> <button class="btn sm ghost" data-del="${m}">Borrar</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="muted">Todavía no hay meses guardados.</div>';
    $$('[data-go]', v).forEach(b => b.onclick = () => { S.current = b.dataset.go; go('resumen'); });
    $$('[data-del]', v).forEach(b => b.onclick = async () => { if (b.dataset.confirm) { await deleteMonth(b.dataset.del); if (!S.history[S.current]) S.current = months().slice(-1)[0] || null; renderAll(); toast('Mes borrado'); } else { b.dataset.confirm = 1; b.textContent = '¿Seguro?'; setTimeout(() => { b.textContent = 'Borrar'; delete b.dataset.confirm; }, 3000); } });
  }

  async function handleFiles(files) {
    files = files.filter(f => /\.xlsx?$/i.test(f.name)); if (!files.length) return;
    loader(true, 'Leyendo reportes…', 5);
    try {
      await loadScript('xlsx');
      const out = [];
      for (let i = 0; i < files.length; i++) {
        loader(true, `Leyendo ${i + 1} de ${files.length}: ${files[i].name.slice(0, 40)}`, 5 + 80 * i / files.length);
        const buf = await files[i].arrayBuffer();
        await new Promise(r => setTimeout(r, 10));
        try { out.push(C.readReport(buf, files[i].name)); } catch (e) { console.error(e); out.push({ key: null, filename: files[i].name, name: 'No se pudo leer', meta: {}, aoa: [], rows: [] }); }
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
      S.models[month] = { model: md, reports: merged };
      S.history[month] = ag; S.current = month;
      const saved = await saveMonth(ag);
      loader(false);
      const unk = out.filter(r => !r.key).length;
      toast(`${C.monthLabel(month)}: ${known.length} reportes leídos${unk ? `, ${unk} sin reconocer` : ''}. ${saved ? 'Guardado en tu historial.' : ''}`, 5000);
      renderAll(); go('resumen');
    } catch (e) { loader(false); console.error(e); toast('Error al leer: ' + e.message, 6000); }
  }

  // ---------- navegación ----------
  const VIEWS = { resumen: renderResumen, morosidad: renderMora, meta: renderMeta, ingresos: renderIngresos, excel: renderExcel, presentacion: renderPres, reportes: renderReportes, cargar: renderCargar };
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
  function renderAll() { renderStamp++; renderMonthSel(); go(S.tab); }
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  $$('#tabs a').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.v); });
  $('#monthSel').onchange = e => { S.current = e.target.value; renderAll(); };
  $('#btnUpload').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = e => { handleFiles([...e.target.files]); e.target.value = ''; };

  // ---------- inicio ----------
  (async function init() {
    loadScript('xlsx').catch(() => { });
    await storeInit();
    S.current = months().slice(-1)[0] || null;
    const h = location.hash.slice(1); S.tab = VIEWS[h] ? h : 'resumen';
    renderAll();
    capUse('downloads').then(d => S.downloads = d);
  })();
})();
