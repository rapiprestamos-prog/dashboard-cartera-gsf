/**
 * Base de datos del Dashboard de Cartera GSF en Google Sheets.
 *
 * Instalación (una sola vez):
 *  1. Crea un Google Sheet nuevo (por ejemplo "Historial dashboard cartera").
 *  2. Menú Extensiones → Apps Script. Borra lo que haya y pega todo este archivo.
 *  3. Cambia CLAVE por una clave larga y secreta (la misma que pondrás en el dashboard).
 *  4. Guarda. Ejecuta la función "instalar" una vez y acepta los permisos.
 *  5. Implementar → Nueva implementación → tipo "Aplicación web".
 *       Ejecutar como: Yo.   Quién tiene acceso: Cualquier persona.
 *     Copia la URL que termina en /exec y pégala en el dashboard (Cargar / historial → Google Sheets).
 *
 * Hojas que crea:
 *  - Meses:    un renglón por mes con los totales (cartera, mora, recaudo, meta...) y el resumen completo en JSON.
 *  - Clientes: un renglón por préstamo y mes (solo si en el dashboard activas "guardar detalle por cliente").
 *  - Modelo:   el detalle comprimido que usa el dashboard para reabrir un mes sin volver a subir los reportes.
 *  - Config:   los supuestos de la meta y los nombres de patrono.
 */

const CLAVE = 'CAMBIA-ESTA-CLAVE-POR-UNA-LARGA-Y-SECRETA';
const PARTE = 45000; // caracteres por celda (el límite de Sheets es 50.000)

const COLS_MESES = ['Mes', 'Etiqueta', 'Guardado', 'Préstamos', 'Cartera', 'Monto original', 'Saldo moroso', 'PAR30 %', 'PAR30 sin migrados %', 'Recaudo', 'Letras del mes', 'Meta siguiente', 'Intereses mes', 'GM mes', 'FECI saldo', 'Prima seguro', 'Cancelados', 'Detalle guardado', 'Partes JSON'];
const COLS_CLIENTES = ['Mes', 'Contrato', 'Cliente', 'Cédula', 'Sucursal', 'Producto', 'Patrono', 'Oficial', 'Tramo', 'Días mora', 'Monto', 'Saldo', 'Saldo al día', 'Moroso', 'Letra', 'Forma pago', 'Letras del mes', 'Letras mes siguiente', 'Cobrado en el mes', 'Fecha préstamo', 'Primera letra', 'Última letra', 'Último pago', 'Estado'];

function instalar() {
  hoja_('Meses', COLS_MESES);
  hoja_('Clientes', COLS_CLIENTES);
  hoja_('Modelo', ['Mes', 'Parte', 'Datos']);
  hoja_('Config', ['Clave', 'Valor']);
  const def = SpreadsheetApp.getActive().getSheetByName('Hoja 1') || SpreadsheetApp.getActive().getSheetByName('Sheet1');
  if (def && SpreadsheetApp.getActive().getSheets().length > 4) SpreadsheetApp.getActive().deleteSheet(def);
}

function doGet(e) { return responder_(() => accion_(e.parameter || {}, null)); }
function doPost(e) {
  return responder_(() => {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    return accion_(body, body);
  });
}

function accion_(p, body) {
  if (String(p.key || '') !== CLAVE) throw new Error('Clave incorrecta');
  const a = p.action;
  if (a === 'ping') return { ok: true, hoja: SpreadsheetApp.getActive().getName() };
  if (a === 'list') return { ok: true, meses: listar_() };
  if (a === 'getModel') return { ok: true, data: leerModelo_(p.month) };
  if (a === 'getConfig') return { ok: true, config: leerConfig_() };
  if (!body) throw new Error('Esta acción requiere POST');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (a === 'saveMonth') return { ok: true, guardado: guardarMes_(body) };
    if (a === 'deleteMonth') { borrarMes_(body.month); return { ok: true }; }
    if (a === 'saveConfig') { guardarConfig_(body.config || {}); return { ok: true }; }
  } finally { lock.releaseLock(); }
  throw new Error('Acción desconocida: ' + a);
}

function responder_(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function hoja_(nombre, cols) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(nombre);
  if (!sh) { sh = ss.insertSheet(nombre); }
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@'); // la columna Mes siempre como texto (evita que 2026-09 se vuelva fecha)
  if (sh.getLastRow() === 0) { sh.appendRow(cols); sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#0f2a52').setFontColor('#ffffff'); sh.setFrozenRows(1); }
  return sh;
}
function partes_(s) { const out = []; for (let i = 0; i < s.length; i += PARTE) out.push(s.slice(i, i + PARTE)); return out.length ? out : ['']; }
function borrarFilas_(sh, mes) {
  const n = sh.getLastRow(); if (n < 2) return;
  const vals = sh.getRange(2, 1, n - 1, 1).getDisplayValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] === mes) sh.deleteRow(i + 2);
}
function borrarFilasRapido_(sh, mes) {
  // Para hojas grandes: reescribe sin las filas del mes en un solo paso
  const n = sh.getLastRow(); if (n < 2) return;
  const w = sh.getLastColumn(); const all = sh.getRange(2, 1, n - 1, w).getValues();
  const keep = all.filter(r => String(r[0]) !== mes);
  if (keep.length === all.length) return;
  sh.getRange(2, 1, n - 1, w).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, w).setValues(keep);
}

function guardarMes_(b) {
  const agg = b.agg; if (!agg || !agg.month) throw new Error('Falta el resumen del mes');
  const mes = agg.month; const k = agg.kpi || {};
  const sh = hoja_('Meses', COLS_MESES); borrarFilas_(sh, mes);
  const json = partes_(JSON.stringify(agg));
  const fila = [mes, agg.label, new Date(), k.prestamos, k.cartera, k.montoOriginal, k.moroso, k.par30Pct, k.par30NMPct, k.recaudo, k.letrasMes, k.meta, k.interesesMes, k.gmMes, k.feciSaldo, k.segPrima, k.canceladosN, b.modelo ? 'Sí' : 'No', json.length].concat(json);
  sh.getRange(sh.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
  const sc = hoja_('Clientes', COLS_CLIENTES); borrarFilasRapido_(sc, mes);
  const sm = hoja_('Modelo', ['Mes', 'Parte', 'Datos']); borrarFilasRapido_(sm, mes);
  if (b.modelo) {
    const ps = partes_(b.modelo);
    sm.getRange(sm.getLastRow() + 1, 1, ps.length, 3).setNumberFormat('@').setValues(ps.map((p, i) => [mes, i + 1, p]));
    const cl = b.clientes || [];
    if (cl.length) sc.getRange(sc.getLastRow() + 1, 1, cl.length, COLS_CLIENTES.length).setValues(cl.map(r => [mes].concat(r).slice(0, COLS_CLIENTES.length)));
  }
  ordenar_(sh);
  return mes;
}
function ordenar_(sh) { const n = sh.getLastRow(); if (n > 2) sh.getRange(2, 1, n - 1, sh.getLastColumn()).sort(1); }

function listar_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Meses'); if (!sh || sh.getLastRow() < 2) return [];
  const n = sh.getLastRow(), w = sh.getLastColumn(); const vals = sh.getRange(2, 1, n - 1, w).getValues();
  const base = COLS_MESES.length;
  return vals.map(r => {
    const np = Number(r[base - 1]) || 1; const txt = r.slice(base, base + np).join('');
    let agg = null; try { agg = JSON.parse(txt); } catch (e) { }
    return { month: String(r[0]), detalle: r[base - 2] === 'Sí', agg };
  }).filter(x => x.agg);
}
function leerModelo_(mes) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Modelo'); if (!sh || sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().filter(r => String(r[0]) === String(mes)).sort((a, b) => a[1] - b[1]);
  return vals.length ? vals.map(r => r[2]).join('') : null;
}
function borrarMes_(mes) {
  ['Meses', 'Clientes', 'Modelo'].forEach(n => { const sh = SpreadsheetApp.getActive().getSheetByName(n); if (sh) (n === 'Meses' ? borrarFilas_ : borrarFilasRapido_)(sh, String(mes)); });
}
function leerConfig_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Config'); if (!sh || sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues(); const r = vals.find(v => v[0] === 'config');
  try { return r ? JSON.parse(r[1]) : null; } catch (e) { return null; }
}
function guardarConfig_(cfg) {
  const sh = hoja_('Config', ['Clave', 'Valor']); borrarFilas_(sh, 'config');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([['config', JSON.stringify(cfg)]]);
}
