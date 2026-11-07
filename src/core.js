/* Motor de datos: lectura de reportes del SIF, modelo mensual, agregados, meta de cobros y filas GSF.
   Funciona en navegador (window.Core) y en Node (module.exports). Requiere XLSX (SheetJS). */
(function (root) {
  'use strict';
  const XL = () => (typeof XLSX !== 'undefined') ? XLSX : (typeof require !== 'undefined' ? require('xlsx') : null);
  const CONTRACT = /^\d{4}CPP\d+$/;

  const REPORTS = [
    { key: 'cierre', code: 'pprprestamomnoaccrual01_s', name: 'Morosidad x días de mora al cierre', core: true },
    { key: 'rubros', code: 'pprprestamosalrub', name: 'Saldos rubros de la cartera agregada', core: true },
    { key: 'patrono', code: 'pprcarteraact03', name: 'Cartera activa x tipo de patrono', core: true },
    { key: 'producto', code: 'pprcarteraact02', name: 'Cartera activa x tipo de producto', core: true },
    { key: 'recaudo', code: 'pprpagos04', name: 'Informe recaudado', core: true },
    { key: 'banca', code: 'pprcarteraact01', name: 'Cartera activa x tipo de banca' },
    { key: 'productoEsp', code: 'pprcarteraact02b', name: 'Cartera activa especial x producto (vencidos)' },
    { key: 'especial', code: 'ppranasaldo', name: 'Análisis especial de saldos (sucursal)' },
    { key: 'moraFecha', code: 'pprprestamomnoaccrual02_s', name: 'Morosidad x días de mora a la fecha' },
    { key: 'moraProducto', code: 'pprprestamomoro02', name: 'Morosidad x tipo de producto' },
    { key: 'moraBanca', code: 'pprprestamomoro01', name: 'Morosidad x tipo de banca' },
    { key: 'pagos', code: 'pprpagos02', name: 'Pagos aplicados (agregado y descontado)' },
    { key: 'intereses', code: 'pprintgasm01', name: 'Intereses y gastos de manejo generados' },
    { key: 'cancelados', code: 'pprpcancelado01', name: 'Préstamos cancelados en el periodo' },
    { key: 'aVencer', code: 'pprpvencidos02', name: 'Préstamos a vencer en el periodo' },
    { key: 'vencidos', code: 'pprpvencidos01', name: 'Préstamos vencidos a la fecha' },
    { key: 'segvida', code: 'pprinfsegvida01', name: 'Seguro de vida (por aseguradora)', multi: true },
    { key: 'feci', code: 'feci', name: 'FECI' }
  ];
  const BY_CODE = {}; REPORTS.forEach(r => BY_CODE[r.code] = r);
  const BY_KEY = {}; REPORTS.forEach(r => BY_KEY[r.key] = r);

  const BUCKETS = ['0 - 30', '31 - 60', '61 - 90', '91 - 120', '121 - 365', '365 Mas'];
  const AGING = ['30', '60', '90', '120', '180', '365', 'Mas 365'];
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const DEFAULT_CONFIG = {
    meta: {
      cuotaHastaDias: 1e9,         // letras del mes de préstamos con mora hasta X días (1e9 = todos, como el reporte de letras)
      efectividadCuotas: 100,      // % de esas letras que se espera cobrar
      recupera: [0, 0, 0, 0, 0, 0] // % del saldo moroso que se espera recuperar por tramo (adicional a las letras)
    },
    patronoMap: {},
    excluirMigradosEnIndice: false
  };

  // ---------- utilidades ----------
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : (v == null || v === '' ? 0 : (isFinite(+v) ? +v : 0));
  const str = v => v == null ? '' : String(v).trim();
  const r2 = v => Math.round(v * 100) / 100;
  function serialToISO(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms); if (isNaN(d)) return null;
      return d.toISOString().slice(0, 10);
    }
    const s = String(v);
    let m = s.match(/^(\d{4})-(\d\d)-(\d\d)/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d\d)\/(\d\d)\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
  }
  const validDate = d => d && d > '1901-01-01' ? d : null;
  function bucketOf(dias) {
    const d = num(dias);
    return d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : d <= 120 ? 3 : d <= 365 ? 4 : 5;
  }
  const freqFactor = f => ({ Q: 2, M: 1, S: 4, D: 30, B: 0.5, T: 1 / 3 })[str(f).toUpperCase()] || 1;
  const freqName = f => ({ Q: 'Quincenal', M: 'Mensual', S: 'Semanal', D: 'Diario', B: 'Bimestral', T: 'Trimestral' })[str(f).toUpperCase()] || str(f);
  const monthLabel = ym => { if (!ym) return '—'; const [y, m] = ym.split('-'); return `${MESES[+m - 1]} ${y}`; };
  const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const nextMonth = ym => { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };

  // Letras que vencen en un mes: quincenal = día 15 y fin de mes; mensual = el día de la fecha final.
  // Solo cuentan las fechas entre la primera y la última letra del préstamo.
  function letrasEnMes(l, ym) {
    if (!l.letra || !l.fvenc || !ym) return 0;
    const [y, m] = ym.split('-').map(Number); const E = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const f = String(l.freq || '').toUpperCase();
    const days = f === 'Q' ? [15, E] : f === 'M' ? [Math.min(+l.fvenc.slice(8, 10) || E, E)] : f === 'S' ? [7, 14, 21, 28].filter(d => d <= E) : [E];
    const ini = l.fini || l.fprest; let n = 0;
    for (const d of days) { const s = `${ym}-${String(d).padStart(2, '0')}`; if ((!ini || s >= ini) && s <= l.fvenc) n++; }
    return Math.round(n * l.letra * 100) / 100;
  }

  // ---------- lectura ----------
  function bufToAOA(buf, filename) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const head = new TextDecoder('ascii').decode(u8.slice(0, 200));
    let wb;
    if (/^\s*<\?xml/.test(head) || /<Workbook/i.test(head) || /<html/i.test(head)) {
      const enc = (head.match(/encoding="([^"]+)"/i) || [])[1] || 'windows-1252';
      let text;
      try { text = new TextDecoder(enc.toLowerCase()).decode(u8); } catch (e) { text = new TextDecoder('windows-1252').decode(u8); }
      wb = XL().read(text, { type: 'string', raw: true });
    } else {
      wb = XL().read(u8, { type: 'array', raw: true });
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XL().utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }

  function identify(aoa, filename) {
    for (let i = 0; i < Math.min(10, aoa.length); i++) {
      const r = aoa[i] || [];
      for (let j = 0; j < r.length; j++) {
        if (str(r[j]) === 'Reporte:') {
          for (let k = j + 1; k < r.length; k++) if (str(r[k])) { const code = str(r[k]); return BY_CODE[code] ? BY_CODE[code].key : null; }
        }
      }
    }
    const h = (aoa[0] || []).map(str);
    if (h.includes('no_prest') && h.includes('feci_mes')) return 'feci';
    return null;
  }

  function reportMeta(aoa) {
    const lines = aoa.slice(0, 8).map(r => (r || []).map(str).filter(Boolean).join(' | '));
    const text = lines.join('\n');
    let month = null, vote = false, title = str((aoa[1] || [])[0]) || str((aoa[0] || [])[0]);
    let m = text.match(/AL CIERRE\s+(\d{4})(\d{2})/i);
    if (m) { month = `${m[1]}-${m[2]}`; vote = true; }
    if (!month) { m = text.match(/del\s+(\d\d)\/(\d\d)\/(\d{4})\s+al\s+(\d\d)\/(\d\d)\/(\d{4})/i); if (m) { month = `${m[6]}-${m[5]}`; vote = true; } }
    if (!month) { m = text.match(/Per[ií]odo:\s*(\d{4})\/(\d{2})/i); if (m) { month = `${m[1]}-${m[2]}`; vote = true; } }
    const printed = (text.match(/Fecha\/hora:\s*\|?\s*(\d\d)\/(\d\d)\/(\d{4})/) || []);
    const aseg = (text.match(/Aseguradora:\s*([^|\n]+)/) || [])[1];
    const printedRaw = (text.match(/Fecha\/hora:\s*\|?\s*(\d\d\/\d\d\/\d{4}[^|\n]*)/) || [])[1];
    return { title, month, vote, printedRaw: printedRaw ? printedRaw.trim() : null, printed: printed[0] ? `${printed[3]}-${printed[2]}-${printed[1]}` : null, aseguradora: aseg ? aseg.trim() : null };
  }

  // Recorre filas de detalle (contrato en col 0) llevando el grupo vigente
  function walk(aoa, groupTest) {
    const out = []; let group = null; let sub = null;
    for (const r of aoa) {
      if (!r) continue;
      const c0 = str(r[0]);
      if (CONTRACT.test(c0)) { out.push({ r, group, sub }); continue; }
      if (groupTest) { const g = groupTest(c0, r); if (g) { if (g.sub) sub = g.sub; else { group = g.group; } } }
    }
    return out;
  }
  const onlyFirst = r => r.slice(1).every(v => v == null || v === '');

  const PARSERS = {
    cierre(aoa) {
      return walk(aoa, (c0, r) => /^\d{2}\s+\S/.test(c0) && onlyFirst(r) ? { group: c0 } : null).map(({ r, group }) => ({
        id: str(r[0]), nombre: str(r[1]), monto: num(r[2]), saldo: num(r[3]), fprest: serialToISO(r[4]), fult: serialToISO(r[5]), fvenc: serialToISO(r[6]),
        dias: num(r[7]), corriente: num(r[8]), aging: [9, 10, 11, 12, 13, 14, 15].map(i => num(r[i])), totalMoroso: num(r[17]), sucursal: group
      }));
    },
    moraFecha(aoa) { return PARSERS.cierre(aoa); },
    rubros(aoa) {
      return walk(aoa).map(({ r }) => ({
        id: str(r[0]), suc: num(r[1]), fprest: serialToISO(r[2]), fvenc: serialToISO(r[3]), nombre: str(r[4]), cedula: str(r[5]), cedulaRaw: r[5], tint: r[6], niv: str(r[7]),
        gm: r[8], letra: num(r[9]), freq: str(r[10]), monto: num(r[11]), fult: serialToISO(r[12]), moraFecha: r[13], moraMonto: r[14],
        saldo: num(r[15]), svp: num(r[16]), capital: num(r[17]), interes: num(r[18]), manejo: num(r[19]), feci: num(r[20]), segVida: num(r[21])
      }));
    },
    _cartera(aoa, groupRe) {
      return walk(aoa, (c0, r) => groupRe.test(c0) && onlyFirst(r) ? { group: c0 } : null).map(({ r, group }) => ({
        id: str(r[0]), suc: num(r[1]), fprest: serialToISO(r[2]), nombre: str(r[3]), cedula: str(r[5]), monto: num(r[6]), saldo: num(r[7]),
        fini: serialToISO(r[8]), fvenc: serialToISO(r[9]), letra: num(r[10]), freq: str(r[11]), pagos: num(r[12]), fult: serialToISO(r[13]),
        corriente: num(r[14]), moroso: num(r[15]), letrasMorosas: num(r[16]), factXCobrar: num(r[17]), oficial: str(r[18]), refi: str(r[19]), group
      }));
    },
    producto(aoa) { return PARSERS._cartera(aoa, /^PRODUCTO:/).map(x => (x.producto = str(x.group).replace(/^PRODUCTO:\s*/, ''), x)); },
    productoEsp(aoa) { return PARSERS.producto(aoa); },
    banca(aoa) { return PARSERS._cartera(aoa, /^BANCA\b/i).map(x => (x.banca = str(x.group), x)); },
    patrono(aoa) {
      return PARSERS._cartera(aoa, /^PATRONO:/).map(x => {
        const g = str(x.group); const m = g.match(/^PATRONO:\s*(\d+)\s+(.*)$/);
        x.patronoCode = m ? m[1] : ''; x.patronoRaw = m ? m[2] : g;
        x.patrono = x.patronoRaw.replace(/\s+\d{3}-\d{4}\s*$/, '').trim();
        return x;
      });
    },
    especial(aoa) {
      let suc = null;
      return walk(aoa, (c0, r) => onlyFirst(r) && c0 && !/^TOTAL/i.test(c0) ? (/^BANCA/i.test(c0) ? { sub: c0 } : { group: c0 }) : null).map(({ r, group, sub }) => ({
        id: str(r[0]), sucursal: group, producto: sub, valorPresente: num(r[13]), netoActual: num(r[14]), inPago180: str(r[16])
      }));
    },
    _moro(aoa, re) {
      return walk(aoa, (c0, r) => re.test(c0) && onlyFirst(r) ? { group: c0 } : null).map(({ r, group }) => ({
        id: str(r[0]), corriente: num(r[7]), aging: [8, 9, 10, 11, 12, 13, 14].map(i => num(r[i])), factXCobrar: num(r[16]), group
      }));
    },
    moraProducto(aoa) { return PARSERS._moro(aoa, /^PRODUCTO:/); },
    moraBanca(aoa) { return PARSERS._moro(aoa, /^BANCA/i); },
    recaudo(aoa) {
      return walk(aoa).map(({ r }) => ({
        id: str(r[0]), suc: num(r[1]), nombre: str(r[3]), cedula: str(r[4]), fecha: serialToISO(r[5]), recibo: str(r[6]),
        efectivo: num(r[7]), cheque: num(r[8]), total: num(r[9]), explicacion: str(r[10])
      }));
    },
    pagos(aoa) {
      return walk(aoa).map(({ r }) => ({
        id: str(r[0]), nombre: str(r[2]), recibo: str(r[4]), fecha: serialToISO(r[5]), caja: num(r[6]), cxcAgencia: num(r[7]), capital: num(r[8]),
        intereses: num(r[9]), feci: num(r[10]), segVida: num(r[11]), segBien: num(r[12]), cargoLegal: num(r[13]), ingresoMora: num(r[14]),
        ingresosVarios: num(r[15]), ingresoMalas: num(r[16]), devIntereses: num(r[17]), devFeci: num(r[18]), devSegVida: num(r[19]), devExceso: num(r[20])
      }));
    },
    intereses(aoa) {
      return walk(aoa, (c0, r) => /^C[óo]digo de Producto/i.test(c0) ? { group: c0.replace(/^C[óo]digo de Producto:\s*\d+\s*-\s*/i, '') } : null).map(({ r, group }) => ({
        id: str(r[0]), nombre: str(r[2]), producto: group,
        intTotal: num(r[5]), intMes: num(r[6]) + num(r[7]), intMesC: num(r[6]), intMesXC: num(r[7]), intAcum: num(r[8]), intSaldo: num(r[9]),
        gmTotal: num(r[10]), gmMes: num(r[11]) + num(r[12]), gmAcum: num(r[13]), gmSaldo: num(r[14])
      }));
    },
    cancelados(aoa) {
      return walk(aoa).map(({ r }) => ({ id: str(r[0]), tipo: str(r[1]), fprest: serialToISO(r[2]), nombre: str(r[3]), cedula: str(r[4]), fcancel: serialToISO(r[7]), monto: num(r[8]), intereses: num(r[9]), gm: num(r[10]) }));
    },
    aVencer(aoa) { return PARSERS._venc(aoa); },
    vencidos(aoa) { return PARSERS._venc(aoa); },
    _venc(aoa) {
      return walk(aoa).map(({ r }) => {
        const off = typeof r[9] === 'string' && /^[A-Z]$/.test(str(r[9])) ? 0 : 1; // vencidos trae "T. Días"
        return {
          id: str(r[0]), fprest: serialToISO(r[1]), nombre: str(r[2]), cedula: str(r[3]), monto: num(r[4]), saldo: num(r[5]), fvenc: serialToISO(r[7]),
          diasVencido: off ? num(r[8]) : 0, letra: num(r[8 + off]), freq: str(r[9 + off]), corriente: num(r[12 + off]), vencido: num(r[13 + off]), totalFact: num(r[15 + off]), oficial: str(r[16 + off])
        };
      });
    },
    segvida(aoa, meta) {
      return walk(aoa).map(({ r }) => ({ id: str(r[0]), nombre: str(r[1]), sexo: str(r[6]), edad: num(r[5]), montoNeto: num(r[8]), saldoNeto: num(r[9]), plazo: num(r[10]), tarifa: num(r[13]), prima: num(r[14]), tipo: str(r[15]), aseguradora: meta && meta.aseguradora }));
    },
    feci(aoa) {
      const h = (aoa[0] || []).map(str); const ix = n => h.indexOf(n);
      return aoa.slice(1).filter(r => r && CONTRACT.test(str(r[ix('no_prest')]))).map(r => ({
        id: str(r[ix('no_prest')]), feci: num(r[ix('feci')]), feciDeven: num(r[ix('feci_deven')]), feciMes: num(r[ix('feci_mes')]), saldoFeci: num(r[ix('saldo_feci')]), pagosMes: num(r[ix('pagos_mes')]), estatus: str(r[ix('estatus')])
      }));
    }
  };

  // Lee un archivo -> objeto reporte
  function readReport(buf, filename) {
    const aoa = bufToAOA(buf, filename);
    const key = identify(aoa, filename);
    const meta = reportMeta(aoa);
    let rows = [];
    if (key && PARSERS[key]) { try { rows = PARSERS[key](aoa, meta); } catch (e) { console.error(key, e); } }
    return { key, filename, name: key ? BY_KEY[key].name : 'No reconocido', meta, aoa, rows };
  }

  function batchMonth(reports) {
    const votes = {};
    reports.forEach(r => { if (r.meta.vote && r.meta.month) votes[r.meta.month] = (votes[r.meta.month] || 0) + (r.key === 'cierre' ? 5 : 1); });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
    const p = reports.map(r => r.meta.printed).filter(Boolean).sort()[0];
    if (p) { let [y, m] = p.split('-').map(Number); m--; if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; }
    return null;
  }

  // ---------- modelo ----------
  function buildModel(reports, config) {
    config = config || DEFAULT_CONFIG;
    const R = {}; reports.forEach(r => { if (!r.key) return; if (BY_KEY[r.key].multi) (R[r.key] = R[r.key] || []).push(...r.rows); else R[r.key] = r.rows; });
    const month = batchMonth(reports);
    const idx = arr => { const m = new Map(); (arr || []).forEach(x => m.set(x.id, x)); return m; };
    const I = {}; ['rubros', 'patrono', 'producto', 'banca', 'especial', 'moraFecha', 'intereses', 'feci', 'productoEsp'].forEach(k => I[k] = idx(R[k]));
    const segv = new Map(); (R.segvida || []).forEach(s => segv.set(s.id, s));
    const pagado = new Map(); const pagosN = new Map();
    (R.recaudo || []).forEach(p => { pagado.set(p.id, (pagado.get(p.id) || 0) + p.total); pagosN.set(p.id, (pagosN.get(p.id) || 0) + 1); });

    let base = R.cierre;
    let baseFrom = 'cierre';
    if (!base || !base.length) { base = (R.producto || R.patrono || R.banca || []).map(x => ({ id: x.id, nombre: x.nombre, monto: x.monto, saldo: x.saldo, fprest: x.fprest, fult: x.fult, fvenc: x.fvenc, dias: null, corriente: x.corriente, aging: null, totalMoroso: x.moroso })); baseFrom = 'cartera'; }

    const loans = base.map(c => {
      const ru = I.rubros.get(c.id) || {}; const pa = I.patrono.get(c.id) || {}; const pr = I.producto.get(c.id) || I.productoEsp.get(c.id) || {};
      const ba = I.banca.get(c.id) || {}; const es = I.especial.get(c.id) || {}; const mf = I.moraFecha.get(c.id); const it = I.intereses.get(c.id) || {};
      const fe = I.feci.get(c.id) || {}; const sv = segv.get(c.id) || {};
      const cart = pr.id ? pr : (pa.id ? pa : ba);
      const dias = c.dias != null ? c.dias : (cart.letrasMorosas ? cart.letrasMorosas * 15 : 0);
      const b = bucketOf(dias);
      const freq = cart.freq || ru.freq || '';
      const letra = cart.letra || ru.letra || 0;
      const patronoRaw = pa.patrono || '';
      return {
        id: c.id, nombre: c.nombre || cart.nombre || ru.nombre, cedula: cart.cedula || ru.cedula || '', suc: cart.suc || ru.suc || 0,
        sucursal: c.sucursal || es.sucursal || (cart.suc ? 'Sucursal ' + cart.suc : '—'),
        producto: (pr.producto || es.producto || '—').replace(/^BANCA PERSONAL-/, ''), productoFull: pr.producto || es.producto || '—',
        banca: ba.banca || 'BANCA PERSONAL', patrono: patronoRaw || '—', patronoCode: pa.patronoCode || '', patronoGSF: (config.patronoMap || {})[patronoRaw] || patronoRaw,
        oficial: cart.oficial || '—', refi: cart.refi || '', monto: c.monto, saldo: c.saldo, fprest: c.fprest, fini: cart.fini, fvenc: c.fvenc, fult: c.fult,
        letra, freq, cuotaMes: letra * freqFactor(freq), dias, bucket: b, clas: BUCKETS[b], corriente: c.corriente, aging: c.aging, totalMoroso: c.totalMoroso,
        letrasMorosas: cart.letrasMorosas || 0, factXCobrar: cart.factXCobrar || 0, morosoCartera: cart.moroso || 0,
        diasHoy: mf ? mf.dias : null, morosoHoy: mf ? mf.totalMoroso : null,
        estado: ru.niv === 'V' ? 'Vencido' : 'Vigente', rub: ru, valorPresente: es.valorPresente || 0,
        intMes: it.intMes || 0, gmMes: it.gmMes || 0, feciMes: fe.feciMes || 0, segPrima: sv.prima || 0, aseguradora: sv.aseguradora || '',
        pagadoMes: r2(pagado.get(c.id) || 0), pagosMes: pagosN.get(c.id) || 0,
        migrado: /MIGRAD/i.test(pr.producto || es.producto || '')
      };
    });
    const nx = month ? nextMonth(month) : null;
    loans.forEach(l => {
      l.letrasMes = Math.min(letrasEnMes(l, month), Math.max(0, l.saldo));
      l.letrasSig = Math.round(Math.min(letrasEnMes(l, nx), Math.max(0, l.corriente)) * 100) / 100;
    });
    return { month, baseFrom, loans, R, reportsLoaded: reports.filter(r => r.key).map(r => r.key) };
  }

  // ---------- agregados ----------
  function groupSum(loans, keyFn, extra) {
    const m = new Map();
    for (const l of loans) {
      const k = keyFn(l); let g = m.get(k);
      if (!g) { g = { k, n: 0, saldo: 0, moroso: 0, enMora: 0, par30: 0, corriente: 0, cuotaMes: 0, pagado: 0 }; m.set(k, g); }
      g.n++; g.saldo += l.saldo; g.moroso += l.totalMoroso; g.corriente += l.corriente; g.cuotaMes += l.cuotaMes; g.pagado += l.pagadoMes;
      if (l.bucket > 0) { g.enMora++; g.par30 += l.saldo; }
      if (extra) extra(g, l);
    }
    return [...m.values()].map(g => { for (const k in g) if (typeof g[k] === 'number' && k !== 'n' && k !== 'enMora') g[k] = r2(g[k]); return g; }).sort((a, b) => b.saldo - a.saldo);
  }

  // mode 'mes' = letras del mes del cierre (para medir lo cobrado ese mes); 'sig' = letras del mes siguiente (meta a fijar)
  function computeMeta(loans, cfg, mode) {
    const c = Object.assign({}, DEFAULT_CONFIG.meta, cfg || {});
    const sig = mode === 'sig';
    const rows = BUCKETS.map((b, i) => ({ k: b, n: 0, saldo: 0, moroso: 0, cuotas: 0, cuotasAll: 0, cuotasMes: 0, metaCuotas: 0, metaRecup: 0, real: 0 }));
    let metaTotal = 0;
    const perLoan = new Map();
    for (const l of loans) {
      const row = rows[l.bucket];
      row.n++; row.saldo += l.saldo; row.moroso += l.totalMoroso; row.real += l.pagadoMes;
      const lt = sig ? (l.letrasSig != null ? l.letrasSig : Math.min(l.cuotaMes, l.saldo)) : (l.letrasMes != null ? l.letrasMes : Math.min(l.cuotaMes, l.saldo));
      const mc = (l.dias <= c.cuotaHastaDias && l.saldo > 0) ? lt * c.efectividadCuotas / 100 : 0;
      const mr = l.totalMoroso * (c.recupera[l.bucket] || 0) / 100;
      row.cuotas += (l.dias <= c.cuotaHastaDias) ? lt : 0;
      row.cuotasAll += l.letrasSig != null ? l.letrasSig : (l.saldo > 0 ? Math.min(l.cuotaMes, l.saldo) : 0);
      row.cuotasMes += l.letrasMes != null ? l.letrasMes : (l.saldo > 0 ? Math.min(l.cuotaMes, l.saldo) : 0); row.metaCuotas += mc; row.metaRecup += mr;
      perLoan.set(l.id, mc + mr); metaTotal += mc + mr;
    }
    rows.forEach(r => { for (const k in r) if (typeof r[k] === 'number' && k !== 'n') r[k] = r2(r[k]); r.meta = r2(r.metaCuotas + r.metaRecup); });
    const real = r2(loans.reduce((s, l) => s + l.pagadoMes, 0));
    return { cfg: c, rows, metaCuotas: r2(rows.reduce((s, r) => s + r.metaCuotas, 0)), metaRecup: r2(rows.reduce((s, r) => s + r.metaRecup, 0)), meta: r2(metaTotal), real, perLoan };
  }

  const BUCKET_TOP = [30, 60, 90, 120, 365, 1e9];
  function metaFromAgg(agg, cfg, mode) {
    const c = Object.assign({}, DEFAULT_CONFIG.meta, cfg || {});
    const rows = (agg.metaRows || []).map((r, i) => {
      const inc = BUCKET_TOP[i] <= c.cuotaHastaDias;
      const base = mode === 'mes' ? (r.cuotasMes != null ? r.cuotasMes : r.cuotasAll) : r.cuotasAll;
      const mc = inc ? (base != null ? base : r.cuotas) * c.efectividadCuotas / 100 : 0;
      const mr = (r.moroso || 0) * (c.recupera[i] || 0) / 100;
      return Object.assign({}, r, { metaCuotas: r2(mc), metaRecup: r2(mr), meta: r2(mc + mr) });
    });
    return { cfg: c, rows, metaCuotas: r2(rows.reduce((s, r) => s + r.metaCuotas, 0)), metaRecup: r2(rows.reduce((s, r) => s + r.metaRecup, 0)), meta: r2(rows.reduce((s, r) => s + r.meta, 0)), real: r2(rows.reduce((s, r) => s + (r.real || 0), 0)) };
  }

  function aggregate(model, config) {
    config = config || DEFAULT_CONFIG;
    const L = model.loans, R = model.R;
    const sum = (a, f) => r2((a || []).reduce((s, x) => s + f(x), 0));
    const cartera = sum(L, l => l.saldo);
    const par = d => sum(L.filter(l => l.dias > d), l => l.saldo);
    const noMig = L.filter(l => !l.migrado);
    const carteraNM = sum(noMig, l => l.saldo);
    const moroso = sum(L, l => l.totalMoroso);
    const rec = R.recaudo || [];
    const recDia = {}; rec.forEach(p => { if (p.fecha) recDia[p.fecha] = (recDia[p.fecha] || 0) + p.total; });
    const pagos = R.pagos || [];
    const segv = R.segvida || [];
    const segAseg = {}; segv.forEach(s => { const k = s.aseguradora || '—'; segAseg[k] = r2((segAseg[k] || 0) + s.prima); });
    const meta = computeMeta(L, config.meta, 'sig');
    const kpi = {
      cartera, prestamos: L.length, clientes: new Set(L.map(l => l.cedula || l.nombre)).size, montoOriginal: sum(L, l => l.monto),
      corriente: sum(L, l => l.corriente), moroso, enMora: L.filter(l => l.bucket > 0).length,
      par30: par(30), par90: par(90), par365: par(365),
      par30Pct: cartera ? par(30) / cartera : 0, par90Pct: cartera ? par(90) / cartera : 0, morosoPct: cartera ? moroso / cartera : 0,
      carteraNM, par30NM: sum(noMig.filter(l => l.dias > 30), l => l.saldo), par30NMPct: carteraNM ? sum(noMig.filter(l => l.dias > 30), l => l.saldo) / carteraNM : 0,
      prestamosNM: noMig.length, migrados: L.length - noMig.length, carteraMig: r2(cartera - carteraNM),
      vencidosN: L.filter(l => l.estado === 'Vencido').length, vencidosSaldo: sum(L.filter(l => l.estado === 'Vencido'), l => l.saldo),
      recaudo: sum(rec, p => p.total), recaudoEfectivo: sum(rec, p => p.efectivo), recaudoCheque: sum(rec, p => p.cheque), recibos: rec.length,
      clientesPagaron: new Set(rec.map(p => p.id)).size,
      pagosCapital: sum(pagos, p => p.capital), pagosIngVarios: sum(pagos, p => p.ingresosVarios), pagosDevInt: sum(pagos, p => p.devIntereses), pagosDevFeci: sum(pagos, p => p.devFeci), pagosDevSeg: sum(pagos, p => p.devSegVida), pagosDevExceso: sum(pagos, p => p.devExceso),
      interesesMes: sum(R.intereses, x => x.intMes), gmMes: sum(R.intereses, x => x.gmMes), interesesSaldo: sum(R.intereses, x => x.intSaldo), gmSaldo: sum(R.intereses, x => x.gmSaldo),
      feciMes: sum(R.feci, x => x.feciMes), feciPagosMes: sum(R.feci, x => x.pagosMes), feciSaldo: sum(R.feci, x => x.saldoFeci),
      segPrima: sum(segv, s => s.prima), segAsegurados: segv.length,
      canceladosN: (R.cancelados || []).length, canceladosMonto: sum(R.cancelados, x => x.monto), canceladosInt: sum(R.cancelados, x => x.intereses + x.gm),
      aVencerN: (R.aVencer || []).length, aVencerSaldo: sum(R.aVencer, x => x.saldo),
      vencidosRepN: (R.vencidos || []).length, vencidosRepSaldo: sum(R.vencidos, x => x.saldo),
      valorPresente: sum(L, l => l.valorPresente),
      rubCapital: sum(L, l => l.rub.capital || 0), rubInteres: sum(L, l => l.rub.interes || 0), rubManejo: sum(L, l => l.rub.manejo || 0), rubFeci: sum(L, l => l.rub.feci || 0), rubSegVida: sum(L, l => l.rub.segVida || 0),
      meta: meta.meta, metaCuotas: meta.metaCuotas, metaRecup: meta.metaRecup, cuotasProgramadas: sum(L, l => l.cuotaMes), letrasMes: sum(L, l => l.letrasMes || 0), letrasSig: sum(L, l => l.letrasSig || 0)
    };
    const agingTot = AGING.map((a, i) => r2(L.reduce((s, l) => s + (l.aging ? l.aging[i] : 0), 0)));
    const byBucket = BUCKETS.map((b, i) => { const g = L.filter(l => l.bucket === i); return { k: b, n: g.length, saldo: sum(g, l => l.saldo), moroso: sum(g, l => l.totalMoroso), pagado: sum(g, l => l.pagadoMes) }; });
    const top = (arr, n) => { if (arr.length <= n) return arr; const head = arr.slice(0, n); const rest = arr.slice(n); const o = { k: 'Otros (' + rest.length + ')', n: 0, saldo: 0, moroso: 0, enMora: 0, par30: 0, corriente: 0, cuotaMes: 0, pagado: 0 }; rest.forEach(g => { for (const k in o) if (typeof g[k] === 'number') o[k] += g[k]; }); for (const k in o) if (typeof o[k] === 'number') o[k] = r2(o[k]); head.push(o); return head; };
    const contratos = {}; L.forEach(l => contratos[l.id] = l.bucket);
    const prodBucket = groupSum(L, l => l.producto, (g, l) => { g.b = g.b || [0, 0, 0, 0, 0, 0]; g.b[l.bucket] = r2(g.b[l.bucket] + l.saldo); });
    const deep = deepAnalysis(model);
    return {
      v: 2, month: model.month, label: monthLabel(model.month), deep, savedAt: new Date().toISOString(), reports: model.reportsLoaded,
      kpi, agingTot, byBucket,
      byProduct: prodBucket,
      bySucursal: groupSum(L, l => l.sucursal),
      byPatrono: top(groupSum(L, l => l.patrono), 15),
      byOficial: groupSum(L, l => l.oficial),
      byFreq: groupSum(L, l => freqName(l.freq)),
      recaudoDiario: Object.entries(recDia).sort().map(([d, v]) => ({ d, v: r2(v) })),
      interesesProducto: groupBy(R.intereses || [], x => x.producto, x => ({ int: x.intMes, gm: x.gmMes })),
      segAseg,
      metaRows: meta.rows, metaCfg: meta.cfg,
      contratos
    };
  }
  // ---------- análisis a fondo (sin datos personales) ----------
  function deepAnalysis(model) {
    const L = model.loans; const end = model.month ? lastDay(model.month) : new Date().toISOString().slice(0, 10);
    const tot = L.reduce((s, l) => s + l.saldo, 0) || 1;
    const add = (m, k, l) => { let g = m.get(k); if (!g) { g = { k, n: 0, saldo: 0, par30: 0, moroso: 0, pagado: 0 }; m.set(k, g); } g.n++; g.saldo += l.saldo; g.moroso += l.totalMoroso; g.pagado += l.pagadoMes; if (l.dias > 30) g.par30 += l.saldo; };
    const fin = (m, order) => { let arr = [...m.values()]; arr.forEach(g => { g.saldo = r2(g.saldo); g.par30 = r2(g.par30); g.moroso = r2(g.moroso); g.pagado = r2(g.pagado); g.pct = g.saldo / tot; g.par30Pct = g.saldo ? g.par30 / g.saldo : 0; }); if (order) arr.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)); else arr.sort((a, b) => String(a.k).localeCompare(String(b.k))); return arr; };
    // cosechas por año de desembolso
    const vin = new Map(); L.forEach(l => add(vin, l.fprest ? l.fprest.slice(0, 4) : '—', l));
    // perfil de vencimiento
    const MAT = ['Ya vencidos', 'Vence en 12 meses', '1 a 2 años', '2 a 3 años', '3 a 5 años', 'Más de 5 años'];
    const yrs = d => (Date.parse(d) - Date.parse(end)) / (365.25 * 864e5);
    const mat = new Map(); L.forEach(l => { const y = l.fvenc ? yrs(l.fvenc) : 0; add(mat, y < 0 ? MAT[0] : y <= 1 ? MAT[1] : y <= 2 ? MAT[2] : y <= 3 ? MAT[3] : y <= 5 ? MAT[4] : MAT[5], l); });
    // tasas
    const RATE = ['Hasta 10%', '10% a 12%', '12% a 14%', '14% a 16%', 'Más de 16%', 'Sin dato'];
    const rate = new Map(); let wr = 0, ws = 0, wg = 0, wgs = 0;
    L.forEach(l => { const t = +l.rub.tint; const k = !isFinite(t) || !t ? RATE[5] : t <= 10 ? RATE[0] : t <= 12 ? RATE[1] : t <= 14 ? RATE[2] : t <= 16 ? RATE[3] : RATE[4]; add(rate, k, l); if (isFinite(t) && t) { wr += t * l.saldo; ws += l.saldo; } const g = +l.rub.gm; if (isFinite(g) && g) { wg += g * l.saldo; wgs += l.saldo; } });
    // antigüedad del último pago
    const LP = ['Pagó este mes', '1 a 3 meses', '3 a 6 meses', '6 a 12 meses', '1 a 3 años', 'Más de 3 años', 'Nunca ha pagado'];
    const lp = new Map(); L.forEach(l => { const f = validDate(l.fult); let k; if (!f) k = LP[6]; else { const m = (Date.parse(end) - Date.parse(f)) / (30.44 * 864e5); k = m < 1 ? LP[0] : m <= 3 ? LP[1] : m <= 6 ? LP[2] : m <= 12 ? LP[3] : m <= 36 ? LP[4] : LP[5]; } add(lp, k, l); });
    // refinanciados
    const refi = new Map(); L.forEach(l => add(refi, /^S/i.test(l.refi) ? 'Refinanciado' : 'Original', l));
    // forma de pago
    const freq = new Map(); L.forEach(l => add(freq, freqName(l.freq) || '—', l));
    // composición del saldo por tramo (rubros)
    const comp = BUCKETS.map((b, i) => { const g = L.filter(l => l.bucket === i); const s = f => r2(g.reduce((a, l) => a + (l.rub[f] || 0), 0)); return { k: b, capital: s('capital'), interes: s('interes'), manejo: s('manejo'), feci: s('feci'), segVida: s('segVida') }; });
    // concentración por cliente (agrupado por cédula, sin guardar nombres)
    const cl = new Map(); L.forEach(l => { const k = l.cedula || l.nombre; cl.set(k, (cl.get(k) || 0) + l.saldo); });
    const sorted = [...cl.values()].sort((a, b) => b - a); const cum = []; let acc = 0; sorted.forEach(v => { acc += v; cum.push(acc / tot); });
    const at = n => cum[Math.min(n, cum.length) - 1] || 0;
    const pareto = [1, 5, 10, 25, 50, 100].filter(n => n <= sorted.length).map(n => ({ n, pct: at(n) }));
    const multi = [...new Map(L.map(l => [l.cedula || l.nombre, 0])).keys()].length;
    // cuota mensual vs cobrado (eficiencia de cobro de clientes al día)
    return {
      byVintage: fin(vin), byMaturity: fin(mat, MAT), byRate: fin(rate, RATE), byLastPay: fin(lp, LP), byRefi: fin(refi), byFreq: fin(freq), comp,
      tasaProm: ws ? wr / ws : 0, gmProm: wgs ? wg / wgs : 0, clientes: cl.size, conVarios: L.length - multi,
      top10Pct: at(10), top25Pct: at(25), top1Pct: at(1), pareto, curve: cum.filter((_, i) => i % Math.max(1, Math.floor(cum.length / 60)) === 0 || i === cum.length - 1).map(x => +x.toFixed(4)),
      plazoProm: L.length ? L.reduce((s, l) => s + (l.fprest && l.fvenc ? (Date.parse(l.fvenc) - Date.parse(l.fprest)) / (30.44 * 864e5) : 0), 0) / L.length : 0
    };
  }
  // Mayores clientes (requiere el detalle del mes; no se guarda en el historial)
  function topClients(model, n) {
    const tot = model.loans.reduce((s, l) => s + l.saldo, 0) || 1;
    const m = new Map();
    model.loans.forEach(l => {
      const k = l.cedula || l.nombre; let g = m.get(k);
      if (!g) { g = { cedula: l.cedula, nombre: l.nombre, prestamos: 0, contratos: [], monto: 0, saldo: 0, moroso: 0, cuotaMes: 0, pagadoMes: 0, bucket: 0, dias: 0, patrono: l.patrono, oficial: l.oficial, producto: l.producto, fult: l.fult }; m.set(k, g); }
      g.prestamos++; g.contratos.push(l.id); g.monto += l.monto; g.saldo += l.saldo; g.moroso += l.totalMoroso; g.cuotaMes += l.cuotaMes; g.pagadoMes += l.pagadoMes;
      if (l.bucket > g.bucket) { g.bucket = l.bucket; } if (l.dias > g.dias) g.dias = l.dias; if ((l.fult || '') > (g.fult || '')) g.fult = l.fult;
    });
    let acc = 0;
    return [...m.values()].sort((a, b) => b.saldo - a.saldo).slice(0, n || 25).map((g, i) => { acc += g.saldo; return Object.assign(g, { rank: i + 1, pct: g.saldo / tot, cumPct: acc / tot, clas: BUCKETS[g.bucket] }); });
  }

  function groupBy(arr, kf, vf) {
    const m = {}; arr.forEach(x => { const k = kf(x) || '—'; const v = vf(x); m[k] = m[k] || {}; for (const f in v) m[k][f] = r2((m[k][f] || 0) + v[f]); });
    return Object.entries(m).map(([k, v]) => Object.assign({ k }, v));
  }

  // Matriz de transición entre dos meses (por tramo)
  function rollMatrix(prevAgg, curAgg) {
    if (!prevAgg || !curAgg || !prevAgg.contratos || !curAgg.contratos) return null;
    const M = BUCKETS.map(() => BUCKETS.map(() => ({ n: 0, saldo: 0 }))); const salieron = BUCKETS.map(() => ({ n: 0, saldo: 0 }));
    const nuevos = BUCKETS.map(() => ({ n: 0, saldo: 0 }));
    for (const id in prevAgg.contratos) {
      const p0 = prevAgg.contratos[id], c0 = curAgg.contratos[id];
      const b0 = Array.isArray(p0) ? p0[0] : p0; const b1 = c0 == null ? null : (Array.isArray(c0) ? c0[0] : c0);
      if (b1 != null) M[b0][b1].n++; else salieron[b0].n++;
    }
    for (const id in curAgg.contratos) if (prevAgg.contratos[id] == null) { const c1 = curAgg.contratos[id]; nuevos[Array.isArray(c1) ? c1[0] : c1].n++; }
    return { M, salieron, nuevos };
  }

  // ---------- filas del Excel GSF ----------
  const GSF_HEAD = ['N°', 'N° Contrato', 'Patrono', 'Nombre del Cliente', 'Monto Préstamo', 'Saldo Préstamo', 'Fecha Prest', 'Fecha Ult. Pago', 'Fecha Vencimto', 'Dias de Morosidad', 'Clasificación', 'Saldo    Corriente', 30, 60, 90, 120, 180, 365, 'Mas 365', 'Total  Moroso',
    'N° Contrato', 'Suc', 'Fecha Prest', 'Fecha Vencimto', 'Nombre del Cliente', 'Cédula/RUC', '%T Int', 'Estado', '%GM', 'Letra', 'Forma Pago', 'Monto Préstamo', 'F.Ultimo    Pgo', 'Mora a la fecha', 'Monto', 'Préstamo', 'SVP', 'Capital', 'Interes', 'Manejo', 'FECI', 'Seg.Vida'];
  const GSF_TYPES = 'n s s s m m d d d i s m m m m m m m m m s i d d s s n s n m s m d x m m m m m m m m'.split(' ');
  function gsfRows(model, config) {
    config = config || DEFAULT_CONFIG;
    const map = config.patronoMap || {};
    const L = model.loans.slice().sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
    return L.map((l, i) => {
      const ru = l.rub || {};
      const pat = l.patrono === '—' ? '' : (map[l.patrono] != null ? map[l.patrono] : l.patrono);
      const ag = l.aging || [0, 0, 0, 0, 0, 0, 0];
      return [i + 1, l.id, pat, l.nombre, l.monto, l.saldo, l.fprest, l.fult, l.fvenc, l.dias, l.clas, l.corriente, ...ag, l.totalMoroso,
        ru.id || l.id, ru.suc != null ? ru.suc : l.suc, ru.fprest || l.fprest, ru.fvenc || l.fvenc, ru.nombre || l.nombre, ru.cedulaRaw != null ? ru.cedulaRaw : l.cedula, ru.tint != null ? ru.tint : null, l.estado, ru.gm != null ? ru.gm : null,
        ru.letra != null ? ru.letra : l.letra, freqName(ru.freq || l.freq), ru.monto != null ? ru.monto : l.monto, ru.id ? (ru.fult || null) : l.fult, ru.moraFecha != null ? ru.moraFecha : null, ru.moraMonto != null ? ru.moraMonto : null,
        ru.saldo != null ? ru.saldo : l.saldo, ru.svp || 0, ru.capital || 0, ru.interes || 0, ru.manejo || 0, ru.feci || 0, ru.segVida || 0];
    });
  }

  const api = { letrasEnMes, topClients, deepAnalysis, metaFromAgg, BUCKET_TOP, REPORTS, BY_KEY, BUCKETS, AGING, MESES, DEFAULT_CONFIG, GSF_HEAD, GSF_TYPES, readReport, bufToAOA, identify, reportMeta, batchMonth, buildModel, aggregate, computeMeta, rollMatrix, gsfRows, monthLabel, lastDay, nextMonth, freqName, bucketOf, validDate, r2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
