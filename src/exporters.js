/* Exportadores: Excel GSF (igual al modelo), Excel de análisis. Requiere ExcelJS y Core. */
(function (root) {
  'use strict';
  const EX = () => (typeof ExcelJS !== 'undefined') ? ExcelJS : (typeof require !== 'undefined' ? require('exceljs') : null);
  const CoreLib = (typeof Core !== 'undefined') ? Core : (typeof require !== 'undefined' ? require('./core.js') : null);
  const ACC = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';
  const toDate = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const WIDTHS = { A: 6.6, B: 20.4, C: 50.4, D: 43.4, E: 11.6, F: 10.6, G: 11.4, H: 15.6, I: 13.1, J: 10.6, K: 12.7, L: 10.6, M: 10.7, U: 18.6, V: 4, W: 11.1, X: 10.7, Y: 42.7, Z: 12.6, AA: 9.4, AB: 8.3, AC: 5.9, AD: 8, AE: 11.4, AF: 11.4, AG: 11.4, AH: 10.7 };

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
    return wb;
  }

  async function analysisWorkbook(model, agg, config) {
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
      const meta = CoreLib.computeMeta(model.loans, config && config.meta);
      sheet('Gestión de cobro', [['Contrato', 20], ['Cliente', 40], ['Patrono', 40], ['Oficial', 14], ['Tramo', 12], ['Días', 8], ['Cuota mensual', 14, ACC], ['Moroso', 14, ACC], ['Meta', 14, ACC], ['Cobrado', 14, ACC], ['Pendiente', 14, ACC]],
        model.loans.map(l => { const m = meta.perLoan.get(l.id) || 0; return [l.id, l.nombre, l.patrono, l.oficial, l.clas, l.dias, l.cuotaMes, l.totalMoroso, Math.round(m * 100) / 100, l.pagadoMes, Math.max(0, Math.round((m - l.pagadoMes) * 100) / 100)]; })
          .sort((a, b) => b[10] - a[10]));
    }
    return wb;
  }

  const api = { gsfWorkbook, analysisWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Exporters = api;
})(typeof window !== 'undefined' ? window : globalThis);
