/* Exportadores: Excel GSF (igual al modelo), Excel de análisis. Requiere ExcelJS y Core. */
(function (root) {
  'use strict';
  const EX = () => (typeof ExcelJS !== 'undefined') ? ExcelJS : (typeof require !== 'undefined' ? require('exceljs') : null);
  const CoreLib = (typeof Core !== 'undefined') ? Core : (typeof require !== 'undefined' ? require('./core.js') : null);
  const ACC = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';
  const ACCN = '#,##0.00';
  const toDate = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const WIDTHS = { A: 6.6, B: 20.4, C: 50.4, D: 43.4, E: 11.6, F: 10.6, G: 11.4, H: 15.6, I: 13.1, J: 10.6, K: 12.7, L: 10.6, M: 10.7, U: 18.6, V: 4, W: 11.1, X: 10.7, Y: 42.7, Z: 12.6, AA: 9.4, AB: 8.3, AC: 5.9, AD: 8, AE: 11.4, AF: 11.4, AG: 11.4, AH: 10.7 };


  const BLUE = 'FF1F3A5F';
  function tableSheet(wb, name, cols, data, opt) {
    opt = opt || {};
    const s = wb.addWorksheet(name.slice(0, 31));
    let r0 = 1;
    if (opt.title) { s.getCell('A1').value = opt.title; s.getCell('A1').font = { bold: true, size: 14, color: { argb: BLUE } }; if (opt.sub) { s.getCell('A2').value = opt.sub; s.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } }; } r0 = opt.sub ? 4 : 3; }
    const hr = s.getRow(r0);
    cols.forEach((c, j) => { const cell = hr.getCell(j + 1); cell.value = c[0]; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; s.getColumn(j + 1).width = c[1] || 14; });
    hr.height = 32;
    data.forEach((d, i) => { const row = s.getRow(r0 + 1 + i); d.forEach((v, j) => { const cell = row.getCell(j + 1); cell.value = v; if (cols[j][2]) cell.numFmt = cols[j][2]; }); if (i % 2) row.eachCell(c => c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5FB' } }); });
    if (opt.total && data.length) {
      const tr = s.getRow(r0 + 1 + data.length); const a = r0 + 1, b = r0 + data.length;
      cols.forEach((c, j) => { const cell = tr.getCell(j + 1); if (j === 0) cell.value = 'Total'; else if (c[3]) { const L = s.getColumn(j + 1).letter; cell.value = { formula: `SUM(${L}${a}:${L}${b})` }; if (c[2]) cell.numFmt = c[2]; } cell.font = { bold: true }; cell.border = { top: { style: 'thin' } }; });
    }
    s.views = [{ state: 'frozen', ySplit: r0 }];
    if (data.length) s.autoFilter = { from: { row: r0, column: 1 }, to: { row: r0 + data.length, column: cols.length } };
    return s;
  }
  const PCT = '0.0%';
  function addMetaSheets(wb, model, agg, config, prevAgg) {
    const mf = CoreLib.metaFromAgg(prevAgg || agg, config && config.meta, prevAgg ? 'sig' : 'mes');
    const next = CoreLib.metaFromAgg(agg, config && config.meta, 'sig');
    const real = agg.kpi.recaudo;
    const s = wb.addWorksheet('Meta de cobros');
    s.columns = [{ width: 44 }, { width: 18 }];
    s.getCell('A1').value = `Meta de cobros — ${agg.label}`; s.getCell('A1').font = { bold: true, size: 14, color: { argb: BLUE } };
    const c = mf.cfg; const lines = [
      ['Meta del mes', mf.meta, ACC], ['  Letras del mes', mf.metaCuotas, ACC], ['  Recuperación de mora', mf.metaRecup, ACC], ['Cobrado (informe recaudado)', real, ACC],
      ['Cumplimiento', mf.meta ? real / mf.meta : 0, PCT], ['Diferencia (cobrado − meta)', real - mf.meta, ACC], ['', null], [`Meta propuesta ${CoreLib.monthLabel(CoreLib.nextMonth(agg.month))}`, next.meta, ACC], ['', null],
      ['Supuestos', null], ['Letras de préstamos con mora hasta (días)', c.cuotaHastaDias >= 1e8 ? 'Todos' : c.cuotaHastaDias], ['Efectividad esperada en letras', c.efectividadCuotas / 100, PCT],
      ...CoreLib.BUCKETS.slice(1).map((b, i) => [`Recuperar del vencido ${b} días`, (c.recupera[i + 1] || 0) / 100, '0.00%']),
      ['Base de la meta', prevAgg ? `Cierre de ${prevAgg.label}` : `Estimada con el cierre de ${agg.label}`]
    ];
    lines.forEach((l, i) => { const row = s.getRow(3 + i); row.values = [l[0], l[1]]; if (l[2]) row.getCell(2).numFmt = l[2]; if (/^Meta del mes|^Cumplimiento|^Supuestos|^Meta propuesta/.test(l[0])) row.font = { bold: true }; });
    tableSheet(wb, 'Meta por tramo', [['Tramo', 14], ['# Préstamos', 12, null, 1], ['Saldo', 16, ACC, 1], ['Saldo moroso', 16, ACC, 1], ['Meta cuotas', 16, ACC, 1], ['Meta recuperación', 16, ACC, 1], ['Meta total', 16, ACC, 1], ['Cobrado', 16, ACC, 1], ['Cumplimiento', 12, PCT]],
      mf.rows.map((r, i) => { const re = (agg.metaRows[i] || {}).real || 0; return [r.k, r.n, r.saldo, r.moroso, r.metaCuotas, r.metaRecup, r.meta, re, r.meta ? re / r.meta : null]; }), { total: true, title: 'Meta vs cobrado por tramo de mora', sub: agg.label });
    if (model && model.loans) {
      const per = CoreLib.computeMeta(model.loans, config && config.meta, 'mes').perLoan;
      const grp = (f) => { const m = new Map(); model.loans.forEach(l => { const k = f(l) || '—'; const g = m.get(k) || { k, n: 0, saldo: 0, meta: 0, real: 0, noPagaron: 0 }; const mt = per.get(l.id) || 0; g.n++; g.saldo += l.saldo; g.meta += mt; g.real += l.pagadoMes; if (mt > 0.005 && l.pagadoMes <= 0) g.noPagaron++; m.set(k, g); }); return [...m.values()].sort((a, b) => b.meta - a.meta); };
      const gcols = (t) => [[t, 42], ['# Préstamos', 12, null, 1], ['Saldo', 16, ACC, 1], ['Meta', 16, ACC, 1], ['Cobrado', 16, ACC, 1], ['Falta', 16, ACC, 1], ['Cumplimiento', 12, PCT], ['No pagaron', 12, null, 1]];
      const grow = g => [g.k, g.n, g.saldo, Math.round(g.meta * 100) / 100, g.real, Math.max(0, Math.round((g.meta - g.real) * 100) / 100), g.meta ? g.real / g.meta : null, g.noPagaron];
      tableSheet(wb, 'Meta por oficial', gcols('Oficial'), grp(l => l.oficial).map(grow), { total: true, title: 'Meta vs cobrado por oficial de crédito', sub: agg.label });
      tableSheet(wb, 'Meta por patrono', gcols('Patrono'), grp(l => l.patrono).map(grow), { total: true, title: 'Meta vs cobrado por patrono', sub: agg.label });
      const rows = model.loans.map(l => { const m = per.get(l.id) || 0; const est = l.pagadoMes <= 0 ? 'No pagó' : l.pagadoMes + 0.01 < m ? 'Parcial' : 'Cumplió'; return [l.id, l.nombre, l.cedula, l.patrono, l.oficial, l.producto, l.clas, l.dias, l.cuotaMes, l.totalMoroso, Math.round(m * 100) / 100, l.pagadoMes, Math.max(0, Math.round((m - l.pagadoMes) * 100) / 100), m > 0.005 ? est : 'Sin meta', CoreLib.validDate(l.fult) ? toDate(l.fult) : null]; }).filter(r => r[10] > 0 || r[11] > 0).sort((a, b) => b[12] - a[12]);
      const lc = [['Contrato', 20], ['Cliente', 38], ['Cédula', 14], ['Patrono', 38], ['Oficial', 14], ['Producto', 26], ['Tramo', 11], ['Días mora', 9], ['Cuota mensual', 14, ACC, 1], ['Moroso', 14, ACC, 1], ['Meta', 14, ACC, 1], ['Cobrado', 14, ACC, 1], ['Falta', 14, ACC, 1], ['Estado', 11], ['Último pago', 12, 'dd/mm/yyyy']];
      tableSheet(wb, 'Lista de cobro', lc, rows, { total: true, title: 'Lista de cobro — quién debía pagar y cuánto falta', sub: agg.label + ' · ordenada por lo que falta cobrar' });
      tableSheet(wb, 'No pagaron', lc, rows.filter(r => r[13] === 'No pagó'), { total: true, title: 'Clientes con meta que no pagaron en el mes', sub: agg.label });
    }
  }
  // Hoja "Letras de la cartera — meta de cobro mensual" (formato del reporte del usuario), agrupada por sucursal
  function addLetrasSheet(wb, model, ym, opts) {
    if (!model || !model.loans) return;
    opts = opts || {};
    const esMes = ym === model.month;
    const title = `Letras ${CoreLib.monthLabel(ym)}`;
    const s = wb.addWorksheet(title.slice(0, 31));
    const cols = [['N° Contrato', 19], ['Nombre del Cliente', 38], ['Cédula / RUC', 13], ['Saldo Capital con Intereses', 15, ACCN], ['Monto solicitado', 14, ACCN], ['Fecha de Inicio', 12, 'dd/mm/yyyy'], ['Fecha del último pago', 12, 'dd/mm/yyyy'], ['Saldo al día', 14, ACCN], ['Mora', 14, ACCN], ['Letras vencidas por cobrar (atrasadas)', 15, ACCN], ['Días de Mora', 9, '#,##0'], ['Fecha de la primera letra', 12, 'dd/mm/yyyy'], ['Fecha de la última letra', 12, 'dd/mm/yyyy'], ['Letra', 11, ACCN], ['Forma Pago', 11], ['Letras no vencidas (lo que le falta)', 15, ACCN], [esMes ? 'Vencieron en el mes' : 'Vencen este mes', 13, ACCN], ['Meta del mes (a cobrar)', 14, ACCN]];
    if (esMes) cols.push(['Cobrado en el mes', 14, ACCN], ['Falta', 13, ACCN], ['Estado', 10]);
    cols.push(['Grupo', 16]);
    const W = cols.length; const L = c => s.getColumn(c).letter;
    const hdr = (r, text, o) => { s.mergeCells(r, 1, r, W); const c = s.getCell(r, 1); c.value = text; c.font = Object.assign({ name: 'Calibri' }, o); c.alignment = { horizontal: 'center' }; };
    hdr(1, 'GRUPO DE SERVICIOS FINANCIEROS', { bold: true, size: 12 });
    hdr(2, 'Letras de la cartera — meta de cobro mensual', { bold: true, size: 11 });
    hdr(3, `${CoreLib.monthLabel(ym)} · con la cartera al cierre de ${CoreLib.monthLabel(model.month)}`, { size: 10 });
    hdr(4, `Generado el ${new Date().toLocaleString('es-PA')}`, { italic: true, size: 9, color: { argb: 'FF64748B' } });
    const hr = s.getRow(6); hr.height = 42;
    cols.forEach((c, j) => { const cell = hr.getCell(j + 1); cell.value = c[0]; cell.font = { bold: true, size: 10 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEBE2' } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = { bottom: { style: 'thin' } }; s.getColumn(j + 1).width = c[1]; });
    const sumCols = ['Saldo Capital con Intereses', 'Saldo al día', 'Mora', 'Letras vencidas por cobrar (atrasadas)', 'Letras no vencidas (lo que le falta)', esMes ? 'Vencieron en el mes' : 'Vencen este mes', 'Meta del mes (a cobrar)', 'Cobrado en el mes', 'Falta'].map(h => cols.findIndex(c => c[0] === h)).filter(i => i >= 0);
    const groups = new Map();
    model.loans.slice().sort((a, b) => String(a.sucursal).replace(/^\d+\s+/, '').localeCompare(String(b.sucursal).replace(/^\d+\s+/, '')) || a.id.localeCompare(b.id)).forEach(l => { const g = String(l.sucursal || '—').replace(/^\d+\s+/, ''); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(l); });
    let r = 7; const totRows = [];
    for (const [g, arr] of groups) {
      const r0 = r;
      for (const l of arr) {
        const lt = esMes ? (l.letrasMes || 0) : (l.letrasSig || 0);
        const v = [l.id, l.nombre, l.cedula, l.saldo, l.monto, toDate(l.fprest), CoreLib.validDate(l.fult) ? toDate(l.fult) : null, l.corriente, l.totalMoroso, l.factXCobrar, l.dias, toDate(l.fini), toDate(l.fvenc), l.letra, CoreLib.freqName(l.freq).toUpperCase(), l.corriente, lt, lt];
        if (esMes) { const falta = Math.max(0, Math.round((lt - l.pagadoMes) * 100) / 100); v.push(l.pagadoMes, falta, lt <= 0 ? (l.pagadoMes > 0 ? 'Abonó' : '—') : l.pagadoMes <= 0 ? 'No pagó' : falta > 0.01 ? 'Parcial' : 'Pagó'); }
        v.push(g);
        const row = s.getRow(r++); v.forEach((x, j) => { const cell = row.getCell(j + 1); cell.value = x; if (cols[j][2]) cell.numFmt = cols[j][2]; cell.font = { size: 10 }; });
      }
      const tr = s.getRow(r); tr.getCell(1).value = `Total ${g}`;
      sumCols.forEach(j => { tr.getCell(j + 1).value = { formula: `SUBTOTAL(9,${L(j + 1)}${r0}:${L(j + 1)}${r - 1})` }; tr.getCell(j + 1).numFmt = ACCN; });
      tr.eachCell({ includeEmpty: true }, c => { c.font = { bold: true, size: 10 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5FB' } }; c.border = { top: { style: 'thin' } }; });
      totRows.push(r); r++;
    }
    const gt = s.getRow(r); gt.getCell(1).value = 'GRAN TOTAL';
    sumCols.forEach(j => { gt.getCell(j + 1).value = { formula: totRows.map(t => `${L(j + 1)}${t}`).join('+') }; gt.getCell(j + 1).numFmt = ACCN; });
    gt.eachCell({ includeEmpty: true }, c => { c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }; });
    s.getCell(r + 2, 1).value = esMes ? 'Vencieron en el mes: letras con fecha dentro del mes (quincenal: días 15 y fin de mes; mensual: día de la última letra). Cobrado: informe recaudado del mes.' : 'Vencen este mes: letras con fecha dentro del mes, sin pasar de las letras no vencidas al cierre. Quincenal: días 15 y fin de mes; mensual: día de la última letra.';
    s.getCell(r + 2, 1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
    s.views = [{ state: 'frozen', xSplit: 2, ySplit: 6 }];
    s.autoFilter = { from: { row: 6, column: 1 }, to: { row: r - 1, column: W } };
  }
  function addTopSheet(wb, model, agg, n) {
    if (!model || !model.loans) return;
    const top = CoreLib.topClients(model, n || 25);
    tableSheet(wb, `${n || 25} mayores clientes`, [['#', 5], ['Cliente', 38], ['Cédula', 14], ['Préstamos', 10], ['Patrono', 38], ['Oficial', 14], ['Producto', 26], ['Monto original', 15, ACC, 1], ['Saldo', 15, ACC, 1], ['% cartera', 10, '0.00%', 1], ['% acumulado', 11, '0.00%'], ['Tramo', 11], ['Días mora', 9], ['Moroso', 14, ACC, 1], ['Cuota mensual', 14, ACC, 1], ['Cobrado mes', 14, ACC, 1], ['Último pago', 12, 'dd/mm/yyyy']],
      top.map(t => [t.rank, t.nombre, t.cedula, t.prestamos, t.patrono, t.oficial, t.producto, t.monto, t.saldo, t.pct, t.cumPct, t.clas, t.dias, t.moroso, t.cuotaMes, t.pagadoMes, CoreLib.validDate(t.fult) ? toDate(t.fult) : null]),
      { total: true, title: `Los ${n || 25} mayores clientes por saldo`, sub: `${agg.label} · concentran ${(top.length ? top[top.length - 1].cumPct * 100 : 0).toFixed(1)}% de la cartera` });
  }
  function addDeepSheets(wb, agg) {
    const d = agg.deep; if (!d) return;
    const gc = t => [[t, 24], ['# Préstamos', 12, null, 1], ['Saldo', 16, ACC, 1], ['% cartera', 10, PCT, 1], ['PAR30', 16, ACC, 1], ['PAR30 %', 10, PCT], ['Moroso', 16, ACC, 1], ['Cobrado mes', 15, ACC, 1]];
    const gr = g => [g.k, g.n, g.saldo, g.pct, g.par30, g.par30Pct, g.moroso, g.pagado];
    tableSheet(wb, 'Cosechas', gc('Año de desembolso'), d.byVintage.map(gr), { total: true, title: 'Cartera por cosecha (año de desembolso)', sub: agg.label });
    tableSheet(wb, 'Vencimientos', gc('Vence'), d.byMaturity.map(gr), { total: true, title: 'Perfil de vencimiento del saldo', sub: agg.label });
    tableSheet(wb, 'Tasas', gc('Tasa de interés'), d.byRate.map(gr), { total: true, title: `Saldo por tasa de interés · promedio ponderado ${d.tasaProm.toFixed(2)}%`, sub: agg.label });
    tableSheet(wb, 'Último pago', gc('Último pago'), d.byLastPay.map(gr), { total: true, title: 'Antigüedad del último pago', sub: agg.label });
    tableSheet(wb, 'Refinanciados', gc('Tipo'), d.byRefi.concat(d.byFreq.map(x => Object.assign({}, x, { k: 'Forma de pago: ' + x.k }))).map(gr), { title: 'Refinanciados y forma de pago', sub: agg.label });
    tableSheet(wb, 'Composición saldo', [['Tramo', 14], ['Capital', 16, ACC, 1], ['Intereses', 16, ACC, 1], ['Manejo', 16, ACC, 1], ['FECI', 16, ACC, 1], ['Seguro vida', 16, ACC, 1]], d.comp.map(c => [c.k, c.capital, c.interes, c.manejo, c.feci, c.segVida]), { total: true, title: 'Composición del saldo por rubro y tramo', sub: agg.label });
    if (d.seguro) {
      tableSheet(wb, 'Seguro de vida', [['Edad', 16], ['Asegurados', 12, null, 1], ['Prima', 14, ACC, 1], ['Saldo asegurado', 16, ACC, 1]], d.seguro.segAge.map(x => [x.k, x.n, x.prima, x.saldo]), { total: true, title: 'Seguro de vida por edad', sub: `${agg.label} · ${d.seguro.sinSeguroN} préstamos sin seguro (${d.seguro.sinSeguroSaldo.toFixed(2)} de saldo)` });
      tableSheet(wb, 'FECI', [['Tramo', 14], ['Saldo FECI', 16, ACC, 1], ['Saldo seguro vida', 16, ACC, 1]], d.feci.byBucket.map((x, i) => [x.k, x.feci, (d.seguro.segB[i] || {}).seg || 0]), { total: true, title: 'Saldo de FECI y seguro por tramo de mora', sub: `${agg.label} · FECI generado ${d.feci.feciTotal.toFixed(2)} · devengado ${d.feci.devengado.toFixed(2)}` });
      tableSheet(wb, 'Vencidos', [['Antigüedad', 18], ['Préstamos', 12, null, 1], ['Saldo', 16, ACC, 1]], (d.vencAge || []).map(x => [x.k, x.n, x.saldo]), { total: true, title: 'Préstamos vencidos por antigüedad', sub: agg.label });
    }
    tableSheet(wb, 'Concentración', [['Mayores N clientes', 18], ['% de la cartera', 16, '0.0%']], d.pareto.map(p => [`Top ${p.n}`, p.pct]), { title: 'Concentración de la cartera por cliente', sub: `${agg.label} · ${d.clientes} clientes` });
  }

  async function gsfWorkbook(model, config, opts) {
    opts = opts || {};
    const rows = CoreLib.gsfRows(model, config);
    const cierre = (model.R && model.R.cierre) ? null : null;
    const ym = (model.month || '').replace('-', '');
    const wb = new (EX().Workbook)();
    wb.creator = 'Dashboard de Cartera'; wb.created = new Date();
    const ws = wb.addWorksheet('cart. cierre + cart. agregada');
    const font = { name: 'Calibri', size: 11 };
    const set = (addr, v, o) => { const c = ws.getCell(addr); c.value = v; c.font = Object.assign({}, font, o && o.bold ? { bold: true } : {}); if (o && o.fmt) c.numFmt = o.fmt; if (o && o.align) c.alignment = { horizontal: o.align }; return c; };
    const total = rows.reduce((s, r) => s + (r[5] || 0), 0);
    const meta = opts.cierreMeta || {};
    set('B1', 'GRUPO DE SERVICIOS FINANCIEROS,S.A.', { bold: true, align: 'left' });
    set('B2', `INF. MOROSIDAD x DIAS DE MORA AL CIERRE ${ym}`, { bold: true, align: 'left' });
    set('B3', 'AGRUPADO x SUCURSAL, Todos los Préstamos Activos al cierre indicado', { align: 'left' });
    set('H2', 'TOTAL CARTERA:', { bold: true, align: 'right' }); set('I2', Math.round(total * 100) / 100, { bold: true, fmt: ACC, align: 'right' });
    set('H3', '# PRESTAMOS:', { bold: true, align: 'right' }); set('I3', rows.length, { bold: true, align: 'right' });
    set('H4', '# CLIENTES:', { bold: true, align: 'right' }); set('I4', new Set(rows.map(r => r[25] || r[3])).size, { bold: true, align: 'right' });
    set('R2', 'Reporte:'); set('S2', 'pprprestamomnoaccrual01_s');
    set('R3', 'Generado:'); set('S3', 'Dashboard de Cartera');
    set('R4', 'Fecha/hora:'); set('S4', meta.printed || new Date().toISOString().slice(0, 10));
    set('M5', '|---------------------------------------------- Saldo Moroso ----------------------------------------------|');
    set('AJ5', '[ ----------------------------------------   S  a  l  d  o  s  ------------------------------------------- ]');
    const head = ws.getRow(6); head.height = 30;
    CoreLib.GSF_HEAD.forEach((h, j) => {
      const c = head.getCell(j + 1); c.value = h; c.font = Object.assign({ bold: true }, font);
      c.alignment = { horizontal: j === 0 ? 'center' : (typeof h === 'number' ? 'left' : 'center'), vertical: 'middle', wrapText: true };
      c.border = { bottom: { style: 'thin' }, top: { style: 'thin' } };
      if (typeof h === 'number') c.numFmt = '########0';
    });
    const T = CoreLib.GSF_TYPES;
    rows.forEach((r, i) => {
      const row = ws.getRow(7 + i);
      r.forEach((v, j) => {
        const c = row.getCell(j + 1); const t = T[j];
        if (t === 'd') { c.value = toDate(v); c.numFmt = 'mm-dd-yy'; }
        else if (t === 'm') { c.value = (v == null ? null : v); c.numFmt = ACC; }
        else if (t === 'i') { c.value = v; c.numFmt = '###,###,##0'; c.alignment = { horizontal: 'right' }; }
        else if (t === 'x') { c.value = (v === '' ? null : v); c.alignment = { horizontal: 'left' }; if (typeof v === 'number') c.numFmt = '########0'; }
        else if (t === 'n') { c.value = v; c.alignment = { horizontal: 'center' }; if (j > 0) c.numFmt = '########0.00'; }
        else { c.value = v; c.alignment = { horizontal: j === 10 ? 'center' : 'left' }; }
        c.font = font;
      });
    });
    Object.entries(WIDTHS).forEach(([k, w]) => ws.getColumn(k).width = w);
    for (const k of ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'AI', 'AJ', 'AK', 'AL', 'AM', 'AN', 'AO', 'AP']) ws.getColumn(k).width = 11.4;
    ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 6 }];
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + rows.length, column: CoreLib.GSF_HEAD.length } };

    const extra = opts.sheets || {};
    if (opts.resumen) {
      const s = wb.addWorksheet('Resumen');
      s.columns = [{ width: 42 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 12 }];
      const H = (r, vals) => { const row = s.getRow(r); vals.forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }; c.alignment = { horizontal: 'center', wrapText: true }; }); };
      s.getCell('A1').value = `Resumen cartera al cierre ${CoreLib.monthLabel(model.month)}`; s.getCell('A1').font = { bold: true, size: 14 };
      let r = 3;
      const block = (title, groups) => {
        H(r, [title, '# Préstamos', 'Saldo préstamo', 'Total moroso', '% cartera']); r++;
        const start = r;
        groups.forEach(g => { const row = s.getRow(r++); row.values = [g.k, g.n, g.saldo, g.moroso, total ? g.saldo / total : 0]; row.getCell(3).numFmt = ACC; row.getCell(4).numFmt = ACC; row.getCell(5).numFmt = '0.0%'; });
        const row = s.getRow(r++); row.values = ['Total', { formula: `SUM(B${start}:B${r - 2})` }, { formula: `SUM(C${start}:C${r - 2})` }, { formula: `SUM(D${start}:D${r - 2})` }, { formula: `SUM(E${start}:E${r - 2})` }];
        row.font = { bold: true }; row.getCell(3).numFmt = ACC; row.getCell(4).numFmt = ACC; row.getCell(5).numFmt = '0.0%';
        r += 1;
      };
      const by = (f) => { const m = new Map(); rows.forEach(x => { const k = f(x) || '(sin patrono)'; const g = m.get(k) || { k, n: 0, saldo: 0, moroso: 0 }; g.n++; g.saldo += x[5] || 0; g.moroso += x[19] || 0; m.set(k, g); }); return [...m.values()]; };
      block('Clasificación', CoreLib.BUCKETS.map(b => by(x => x[10]).find(g => g.k === b) || { k: b, n: 0, saldo: 0, moroso: 0 }));
      block('Patrono', by(x => x[2]).sort((a, b) => b.saldo - a.saldo));
    }
    if (extra.meta && opts.agg) { addLetrasSheet(wb, model, model.month); addLetrasSheet(wb, model, CoreLib.nextMonth(model.month)); addMetaSheets(wb, model, opts.agg, config, opts.prevAgg); }
    if (extra.top25 && opts.agg) addTopSheet(wb, model, opts.agg, 25);
    if (extra.analisis && opts.agg) addDeepSheets(wb, opts.agg);
    return wb;
  }

  async function metaWorkbook(model, agg, config, prevAgg) {
    const wb = new (EX().Workbook)(); wb.created = new Date(); wb.creator = 'Dashboard de Cartera';
    if (model && model.loans) { addLetrasSheet(wb, model, model.month); addLetrasSheet(wb, model, CoreLib.nextMonth(model.month)); }
    addMetaSheets(wb, model, agg, config, prevAgg);
    return wb;
  }

  async function analysisWorkbook(model, agg, config, cuadre) {
    const wb = new (EX().Workbook)(); wb.created = new Date();
    const blue = 'FF1F3A5F';
    const sheet = (name, cols, data, fmts) => {
      const s = wb.addWorksheet(name);
      s.columns = cols.map(c => ({ header: c[0], key: c[0], width: c[1] || 14 }));
      s.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: blue } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
      s.getRow(1).height = 32;
      data.forEach(d => s.addRow(d));
      cols.forEach((c, j) => { if (c[2]) s.getColumn(j + 1).numFmt = c[2]; });
      s.views = [{ state: 'frozen', ySplit: 1 }];
      if (data.length) s.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + data.length, column: cols.length } };
      return s;
    };
    const k = agg.kpi;
    const res = wb.addWorksheet('Resumen');
    res.columns = [{ width: 38 }, { width: 20 }];
    res.getCell('A1').value = `Indicadores de cartera — ${agg.label}`; res.getCell('A1').font = { bold: true, size: 14 };
    const lines = [
      ['Cartera total (saldo)', k.cartera, ACC], ['Préstamos activos', k.prestamos], ['Monto original otorgado', k.montoOriginal, ACC],
      ['Saldo moroso (cuotas vencidas)', k.moroso, ACC], ['Saldo moroso / cartera', k.morosoPct, '0.0%'],
      ['Cartera en riesgo > 30 días (PAR30)', k.par30, ACC], ['PAR30 %', k.par30Pct, '0.0%'], ['PAR90 %', k.par90Pct, '0.0%'],
      ['Cartera sin migrados', k.carteraNM, ACC], ['PAR30 % sin migrados', k.par30NMPct, '0.0%'],
      ['Recaudo del mes', k.recaudo, ACC], ['Meta de cobro (modelo)', k.meta, ACC], ['Cumplimiento', k.meta ? k.recaudo / k.meta : 0, '0.0%'],
      ['Intereses devengados del mes', k.interesesMes, ACC], ['Gastos de manejo del mes', k.gmMes, ACC], ['FECI del mes', k.feciMes, ACC],
      ['Prima seguro de vida', k.segPrima, ACC], ['Préstamos cancelados', k.canceladosN], ['Monto cancelado', k.canceladosMonto, ACC]
    ];
    lines.forEach((l, i) => { const row = res.getRow(3 + i); row.values = [l[0], l[1]]; if (l[2]) row.getCell(2).numFmt = l[2]; });
    sheet('Por tramo de mora', [['Tramo', 14], ['# Préstamos', 12], ['Saldo', 16, ACC], ['Moroso', 16, ACC], ['Cobrado en el mes', 16, ACC]], agg.byBucket.map(b => [b.k, b.n, b.saldo, b.moroso, b.pagado]));
    sheet('Por producto', [['Producto', 40], ['# Préstamos', 12], ['Saldo', 16, ACC], ['Moroso', 16, ACC], ['PAR30', 16, ACC], ['Cobrado', 16, ACC]], agg.byProduct.map(b => [b.k, b.n, b.saldo, b.moroso, b.par30, b.pagado]));
    sheet('Por patrono', [['Patrono', 48], ['# Préstamos', 12], ['Saldo', 16, ACC], ['Moroso', 16, ACC], ['PAR30', 16, ACC], ['Cobrado', 16, ACC]], agg.byPatrono.map(b => [b.k, b.n, b.saldo, b.moroso, b.par30, b.pagado]));
    sheet('Por oficial', [['Oficial', 20], ['# Préstamos', 12], ['Saldo', 16, ACC], ['Moroso', 16, ACC], ['Cuota mensual', 16, ACC], ['Cobrado', 16, ACC]], agg.byOficial.map(b => [b.k, b.n, b.saldo, b.moroso, b.cuotaMes, b.pagado]));
    sheet('Meta de cobros', [['Tramo', 14], ['# Préstamos', 12], ['Cuotas del mes', 16, ACC], ['Meta cuotas', 16, ACC], ['Meta recuperación', 16, ACC], ['Meta total', 16, ACC], ['Cobrado', 16, ACC]], agg.metaRows.map(b => [b.k, b.n, b.cuotas, b.metaCuotas, b.metaRecup, b.meta, b.real]));
    if (model && model.loans) {
      const meta = CoreLib.computeMeta(model.loans, config && config.meta, 'mes');
      sheet('Gestión de cobro', [['Contrato', 20], ['Cliente', 40], ['Patrono', 40], ['Oficial', 14], ['Tramo', 12], ['Días', 8], ['Cuota mensual', 14, ACC], ['Moroso', 14, ACC], ['Meta', 14, ACC], ['Cobrado', 14, ACC], ['Pendiente', 14, ACC]],
        model.loans.map(l => { const m = meta.perLoan.get(l.id) || 0; return [l.id, l.nombre, l.patrono, l.oficial, l.clas, l.dias, l.cuotaMes, l.totalMoroso, Math.round(m * 100) / 100, l.pagadoMes, Math.max(0, Math.round((m - l.pagadoMes) * 100) / 100)]; })
          .sort((a, b) => b[10] - a[10]));
    }
    addTopSheet(wb, model, agg, 25);
    addDeepSheets(wb, agg);
    if (cuadre && cuadre.length) tableSheet(wb, 'Cuadre', [['Estado', 11], ['Tipo', 28], ['Reporte', 44], ['Concepto', 34], ['Dashboard / detalle', 18, ACC], ['Total del reporte', 18, ACC], ['Diferencia', 14, ACC], ['Nota', 60]], cuadre.map(r => [r.ok ? 'Cuadra' : r.nota ? 'Explicada' : 'Diferencia', r.grupo, r.reporte, r.concepto, r.a, r.b, r.diff, r.nota]), { title: 'Cuadre con los reportes del SIF', sub: `${agg.label} · ${cuadre.filter(r => r.ok).length} de ${cuadre.length} comparaciones exactas` });
    return wb;
  }

  async function letrasWorkbook(model, ym) { const wb = new (EX().Workbook)(); wb.created = new Date(); addLetrasSheet(wb, model, ym); return wb; }
  const api = { gsfWorkbook, analysisWorkbook, metaWorkbook, letrasWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Exporters = api;
})(typeof window !== 'undefined' ? window : globalThis);
