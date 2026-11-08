/**
 * Base de datos del Dashboard de Cartera GSF en Google Sheets (mismo esquema que "Seguimiento de tareas").
 *
 * Instalación (una sola vez):
 *  1. Crea un Google Sheet nuevo (por ejemplo "Historial dashboard cartera").
 *  2. Extensiones → Apps Script. Borra lo que haya y pega todo este archivo. Guarda.
 *  3. Vuelve al Sheet y recarga: aparece el menú "Dashboard cartera" → "Instalar". Acepta los permisos.
 *  4. En Apps Script: Implementar → Nueva implementación → Aplicación web.
 *       Ejecutar como: Yo.   Quién tiene acceso: Cualquier usuario.
 *     Copia la URL que termina en /exec y pégala en index.html (PEGAR_AQUI_LA_URL_DEL_APPS_SCRIPT).
 *  5. La primera vez que abras la página te pide crear la cuenta de administración (usuario y contraseña).
 *     Las contraseñas se guardan con sal y SHA-256 repetido 1000 veces; ninguna queda escrita en el código.
 *
 * Hojas: Meses (totales + resumen JSON), Clientes (detalle por préstamo, opcional), Modelo (detalle comprimido),
 *        Config, Usuarios y Sesiones (se guarda la huella del token, no el token).
 */

var HOJA_ID = '';  // opcional: ID del Sheet si el script no está dentro de la hoja
var AJUSTES = { SESION_DIAS: 30, ITERACIONES: 1000, INTENTOS: 5, ESPERA_MIN: 15 };
var PARTE = 45000; // caracteres por celda (el límite de Sheets es 50.000)
var COLS_USUARIOS = ['usuario', 'nombre', 'salt', 'hash', 'activo', 'esAdmin', 'debeCambiar', 'creado', 'rol', 'jefe', 'email', 'estado'];
var NOMBRE_APP = 'Cartera GSF · Dashboard';
/* Jerarquía de roles (de mayor a menor) y lo que puede hacer cada uno:
   admin     → todo, más crear usuarios y asignar roles
   gerencia  → ver todo, cargar meses, borrar meses, cambiar supuestos de la meta, descargar Excel y presentaciones
   analista  → ver todo, cargar meses y descargar (no borra meses ni cambia supuestos)
   consulta  → solo ve los totales y gráficas del historial (sin detalle por cliente ni descargas) */
var ROLES = ['admin', 'gerencia', 'analista', 'consulta'];
var PERMISOS = {
  admin: ['list', 'getModel', 'getFiles', 'getConfig', 'saveMonth', 'deleteMonth', 'saveConfig'],
  gerencia: ['list', 'getModel', 'getFiles', 'getConfig', 'saveMonth', 'deleteMonth', 'saveConfig'],
  analista: ['list', 'getModel', 'getFiles', 'getConfig', 'saveMonth'],
  consulta: ['list', 'getConfig']
};
function rolDe_(u) { return u.esAdmin === 'TRUE' ? 'admin' : (ROLES.indexOf(u.rol) > 0 ? u.rol : 'consulta'); }
var COLS_SESIONES = ['huella', 'usuario', 'creado', 'ultimo', 'vence'];
var COLS_ARCHIVOS = ['Mes', 'Archivo', 'Parte', 'Datos']; // reportes originales del SIF (comprimidos) para volver a descargarlos

function libro_() { return HOJA_ID ? SpreadsheetApp.openById(HOJA_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function sha_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function hashClave_(salt, clave) { var h = sha_(salt + '|' + clave); for (var i = 1; i < AJUSTES.ITERACIONES; i++) h = sha_(salt + '|' + h); return h; }
function uuid_() { return Utilities.getUuid().replace(/-/g, ''); }
function err_(m) { var e = new Error(m); e.usuario = true; return e; }

/* ---------- tablas simples por encabezado ---------- */
function tabla_(nombre, cols) {
  var sh = hoja_(nombre, cols), n = sh.getLastRow();
  if (sh.getLastColumn() < cols.length) sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#0f2a52').setFontColor('#ffffff');
  var vals = n > 1 ? sh.getRange(2, 1, n - 1, cols.length).getValues() : [];
  return { sh: sh, objs: vals.map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i] === true ? 'TRUE' : r[i] === false ? 'FALSE' : String(r[i]); }); return o; }) };
}
function agregar_(sh, cols, o) { sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setNumberFormat('@').setValues([fila_(cols, o)]); }
function fila_(cols, o) { return cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : String(o[c]); }); }
function usuarios_() { return tabla_('Usuarios', COLS_USUARIOS); }
function usuario_(u) { u = String(u || '').trim().toLowerCase(); var T = usuarios_(); for (var i = 0; i < T.objs.length; i++) if (T.objs[i].usuario.toLowerCase() === u) return { T: T, i: i, u: T.objs[i] }; return null; }
function guardarUsuario_(T, i, o) { T.sh.getRange(i + 2, 1, 1, COLS_USUARIOS.length).setNumberFormat('@').setValues([fila_(COLS_USUARIOS, o)]); }
function publico_(u) { var r = rolDe_(u); return { usuario: u.usuario, nombre: u.nombre, rol: r, jefe: u.jefe || '', esAdmin: r === 'admin', activo: u.activo === 'TRUE', permisos: PERMISOS[r], email: u.email || '', estado: estado_(u), creado: u.creado || '' }; }
function estado_(u) { return u.estado === 'pendiente' || u.estado === 'rechazado' ? u.estado : (u.activo === 'TRUE' ? 'activo' : 'inactivo'); }
function emailValido_(e, requerido) {
  e = String(e || '').trim().toLowerCase();
  if (!e) { if (requerido) throw err_('Escribe tu correo.'); return ''; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 120) throw err_('Correo no válido.');
  return e;
}
/* ---------- correos (MailApp: se envían desde la cuenta dueña del script) ---------- */
function correo_(para, asunto, texto) {
  if (!para) return false;
  try {
    var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;max-width:560px">' +
      '<div style="background:#0f2a52;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:bold">' + NOMBRE_APP + '</div>' +
      '<div style="border:1px solid #e2e8f0;border-top:0;padding:18px;border-radius:0 0 10px 10px;line-height:1.6">' + texto.replace(/\n/g, '<br>') + '</div></div>';
    MailApp.sendEmail({ to: para, subject: asunto + ' · ' + NOMBRE_APP, htmlBody: html, body: texto.replace(/<[^>]+>/g, ''), name: NOMBRE_APP });
    return true;
  } catch (e) { console.error('Correo no enviado a ' + para + ': ' + e); return false; }
}
function correosAdmins_() {
  var out = usuarios_().objs.filter(function (u) { return rolDe_(u) === 'admin' && u.activo === 'TRUE' && u.email; }).map(function (u) { return u.email; });
  if (!out.length) { try { var d = Session.getEffectiveUser().getEmail(); if (d) out.push(d); } catch (e) { } }
  return out.join(',');
}
function enlace_(url) { url = String(url || ''); return /^https:\/\//.test(url) ? '<a href="' + url + '">' + url + '</a>' : 'la página del dashboard'; }

/* ---------- sesiones (30 días) ---------- */
function sesionCrear_(usuario) {
  var token = uuid_() + uuid_(), ahora = Date.now(), T = tabla_('Sesiones', COLS_SESIONES);
  agregar_(T.sh, COLS_SESIONES, { huella: sha_(token), usuario: usuario, creado: new Date().toISOString(), ultimo: ahora, vence: ahora + AJUSTES.SESION_DIAS * 864e5 });
  if (T.objs.length > 50) sesionesBorrar_(function (s) { return Number(s.vence) < ahora; });
  return token;
}
function sesionUsuario_(token) {
  if (!token) throw err_('SESION');
  var h = sha_(String(token)), T = tabla_('Sesiones', COLS_SESIONES), ahora = Date.now();
  for (var i = 0; i < T.objs.length; i++) if (T.objs[i].huella === h) {
    var s = T.objs[i]; if (Number(s.vence) < ahora) break;
    var r = usuario_(s.usuario); if (!r || r.u.activo !== 'TRUE' || !r.u.hash) break;
    if (ahora - Number(s.ultimo) > 30 * 60 * 1000) T.sh.getRange(i + 2, 4, 1, 2).setNumberFormat('@').setValues([[String(ahora), String(ahora + AJUSTES.SESION_DIAS * 864e5)]]);
    return r.u;
  }
  throw err_('SESION');
}
function sesionesBorrar_(fn) {
  var T = tabla_('Sesiones', COLS_SESIONES);
  for (var i = T.objs.length - 1; i >= 0; i--) if (fn(T.objs[i])) T.sh.deleteRow(i + 2);
}

/* ---------- intentos fallidos: 5 → 15 minutos ---------- */
var CC = CacheService.getScriptCache();
function fallos_(u) { return Number(CC.get('fallos_' + u) || 0); }

/* ---------- acciones sin sesión ---------- */
var PUBLICAS = {
  setupStatus: function () { return { necesitaConfiguracion: usuarios_().objs.length === 0 }; },
  setupAdmin: function (b) {
    if (usuarios_().objs.length) throw err_('El sistema ya está configurado.');
    var usuario = String(b.usuario || '').trim().toLowerCase(), clave = String(b.password || '');
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw err_('Usuario no válido (3-30 letras minúsculas, números, punto o guion).');
    if (!String(b.nombre || '').trim()) throw err_('Escribe tu nombre.');
    if (clave.length < 8) throw err_('La contraseña debe tener al menos 8 caracteres.');
    var salt = uuid_();
    agregar_(usuarios_().sh, COLS_USUARIOS, { usuario: usuario, nombre: String(b.nombre).trim().slice(0, 80), salt: salt, hash: hashClave_(salt, clave), activo: 'TRUE', esAdmin: 'TRUE', debeCambiar: 'FALSE', creado: new Date().toISOString(), rol: 'admin', jefe: '', email: emailValido_(b.email, false), estado: 'activo' });
    return { ok: true };
  },
  register: function (b) {
    if (!usuarios_().objs.length) throw err_('Primero hay que crear la cuenta de administración.');
    var usuario = String(b.usuario || '').trim().toLowerCase(), clave = String(b.password || ''), nombre = String(b.nombre || '').trim().slice(0, 80), email = emailValido_(b.email, true);
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw err_('Usuario no válido (3-30 letras minúsculas, números, punto o guion).');
    if (!nombre) throw err_('Escribe tu nombre completo.');
    if (clave.length < 8) throw err_('La contraseña debe tener al menos 8 caracteres.');
    var T = usuarios_();
    if (usuario_(usuario)) throw err_('Ese usuario ya existe. Elige otro.');
    if (T.objs.some(function (u) { return String(u.email).toLowerCase() === email && u.estado !== 'rechazado'; })) throw err_('Ya hay una cuenta o solicitud con ese correo.');
    if (T.objs.filter(function (u) { return u.estado === 'pendiente'; }).length >= 30) throw err_('Hay demasiadas solicitudes pendientes. Intenta más tarde.');
    var salt = uuid_();
    agregar_(T.sh, COLS_USUARIOS, { usuario: usuario, nombre: nombre, salt: salt, hash: hashClave_(salt, clave), activo: 'FALSE', esAdmin: 'FALSE', debeCambiar: 'FALSE', creado: new Date().toISOString(), rol: 'consulta', jefe: '', email: email, estado: 'pendiente' });
    correo_(correosAdmins_(), 'Nueva solicitud de acceso', '<b>' + nombre + '</b> (' + usuario + ', ' + email + ') pidió acceso al dashboard.\n\nEntra a ' + enlace_(b.appUrl) + ' → pestaña <b>Usuarios</b> para aprobarla o rechazarla.');
    correo_(email, 'Recibimos tu solicitud', 'Hola ' + nombre + ',\n\nRecibimos tu solicitud de acceso con el usuario <b>' + usuario + '</b>. Te avisaremos por este medio cuando Administración la revise.');
    return { ok: true };
  },
  login: function (b) {
    var usuario = String(b.usuario || '').trim().toLowerCase();
    if (fallos_(usuario) >= AJUSTES.INTENTOS) throw err_('Demasiados intentos fallidos. Espera ' + AJUSTES.ESPERA_MIN + ' minutos e inténtalo de nuevo.');
    var r = usuario_(usuario);
    if (r && r.u.activo === 'TRUE' && !r.u.hash) throw err_('CREAR_CLAVE');
    if (r && (r.u.estado === 'pendiente' || r.u.estado === 'rechazado') && r.u.hash && hashClave_(r.u.salt, String(b.password || '')) === r.u.hash)
      throw err_(r.u.estado === 'pendiente' ? 'Tu solicitud todavía está pendiente de aprobación. Te llegará un correo cuando la aprueben.' : 'Tu solicitud de acceso fue rechazada. Consulta con Administración.');
    if (!r || r.u.activo !== 'TRUE' || hashClave_(r.u.salt, String(b.password || '')) !== r.u.hash) {
      CC.put('fallos_' + usuario, String(fallos_(usuario) + 1), AJUSTES.ESPERA_MIN * 60);
      Utilities.sleep(600); throw err_('Usuario o contraseña incorrectos.');
    }
    CC.remove('fallos_' + usuario);
    return { token: sesionCrear_(r.u.usuario), me: publico_(r.u), debeCambiar: r.u.debeCambiar === 'TRUE' };
  },
  createPassword: function (b) {
    var r = usuario_(b.usuario), clave = String(b.password || '');
    if (!r || r.u.activo !== 'TRUE' || r.u.hash) throw err_('No disponible para este usuario.');
    if (clave.length < 8) throw err_('La contraseña debe tener al menos 8 caracteres.');
    r.u.salt = uuid_(); r.u.hash = hashClave_(r.u.salt, clave); r.u.debeCambiar = 'FALSE'; guardarUsuario_(r.T, r.i, r.u);
    return { ok: true };
  },
  logout: function (b) { if (b.token) { var h = sha_(String(b.token)); sesionesBorrar_(function (s) { return s.huella === h; }); } return { ok: true }; }
};

/* ---------- acciones con sesión ---------- */
var PRIVADAS = {
  ping: function (b, me) { var o = { hoja: libro_().getName(), me: publico_(me) }; if (rolDe_(me) === 'admin') o.pendientes = usuarios_().objs.filter(function (u) { return u.estado === 'pendiente'; }).length; return o; },
  list: function () { return { meses: listar_() }; },
  getModel: function (b) { return { data: leerModelo_(b.month) }; },
  getFiles: function (b) { return { archivos: leerArchivos_(b.month) }; },
  getConfig: function () { return { config: leerConfig_() }; },
  saveMonth: function (b) { return { guardado: guardarMes_(b) }; },
  deleteMonth: function (b) { borrarMes_(b.month); return { ok: true }; },
  saveConfig: function (b) { guardarConfig_(b.config || {}); return { ok: true }; },
  changePassword: function (b, me) {
    var r = usuario_(me.usuario), nueva = String(b.nueva || '');
    if (hashClave_(r.u.salt, String(b.actual || '')) !== r.u.hash) throw err_('La contraseña actual no es correcta.');
    if (nueva.length < 8) throw err_('La contraseña debe tener al menos 8 caracteres.');
    r.u.salt = uuid_(); r.u.hash = hashClave_(r.u.salt, nueva); r.u.debeCambiar = 'FALSE'; guardarUsuario_(r.T, r.i, r.u);
    var salvo = sha_(String(b.token)); sesionesBorrar_(function (s) { return s.usuario.toLowerCase() === r.u.usuario.toLowerCase() && s.huella !== salvo; });
    return { ok: true };
  },
  listUsers: function (b, me) { soloAdmin_(me); return { usuarios: usuarios_().objs.map(publico_) }; },
  addUser: function (b, me) {
    soloAdmin_(me);
    var usuario = String(b.usuario || '').trim().toLowerCase(), clave = String(b.password || '');
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw err_('Usuario no válido (3-30 letras minúsculas, números, punto o guion).');
    if (usuario_(usuario)) throw err_('Ese usuario ya existe.');
    if (clave.length < 8) throw err_('La contraseña temporal debe tener al menos 8 caracteres.');
    var rol = rolValido_(b.rol), jefe = jefeValido_(usuario, b.jefe), salt = uuid_();
    agregar_(usuarios_().sh, COLS_USUARIOS, { usuario: usuario, nombre: String(b.nombre || usuario).trim().slice(0, 80), salt: salt, hash: hashClave_(salt, clave), activo: 'TRUE', esAdmin: rol === 'admin' ? 'TRUE' : 'FALSE', debeCambiar: 'TRUE', creado: new Date().toISOString(), rol: rol, jefe: jefe, email: emailValido_(b.email, false), estado: 'activo' });
    var em = emailValido_(b.email, false);
    if (em) correo_(em, 'Te dieron acceso', 'Hola ' + String(b.nombre || usuario) + ',\n\nAdministración te creó una cuenta en el dashboard con el usuario <b>' + usuario + '</b>. La contraseña temporal te la entrega Administración; al entrar el sistema te pedirá cambiarla.\nEntra en ' + enlace_(b.appUrl) + '.');
    return { ok: true };
  },
  updateUser: function (b, me) {
    soloAdmin_(me); var r = usuario_(b.usuario); if (!r) throw err_('No existe ese usuario.');
    var propio = r.u.usuario.toLowerCase() === me.usuario.toLowerCase();
    if (b.rol !== undefined) { var rol = rolValido_(b.rol); if (propio && rol !== 'admin') throw err_('No puedes quitarte tu propio rol de administración. Pídeselo a otra persona administradora.'); r.u.rol = rol; r.u.esAdmin = rol === 'admin' ? 'TRUE' : 'FALSE'; }
    if (b.jefe !== undefined) r.u.jefe = jefeValido_(r.u.usuario.toLowerCase(), b.jefe);
    if (b.email !== undefined) r.u.email = emailValido_(b.email, false);
    if (b.activo !== undefined) {
      if (propio && !b.activo) throw err_('No puedes desactivar tu propia cuenta.');
      r.u.activo = b.activo ? 'TRUE' : 'FALSE'; if (b.activo) r.u.estado = 'activo'; else if (r.u.estado === 'activo' || !r.u.estado) r.u.estado = '';
      if (!b.activo) sesionesBorrar_(function (s) { return s.usuario.toLowerCase() === r.u.usuario.toLowerCase(); });
    }
    guardarUsuario_(r.T, r.i, r.u);
    return { ok: true };
  },
  approveUser: function (b, me) {
    soloAdmin_(me); var r = usuario_(b.usuario); if (!r) throw err_('No existe ese usuario.');
    if (r.u.estado !== 'pendiente' && r.u.estado !== 'rechazado') throw err_('Ese usuario no tiene una solicitud pendiente.');
    r.u.rol = rolValido_(b.rol); r.u.esAdmin = r.u.rol === 'admin' ? 'TRUE' : 'FALSE';
    r.u.jefe = jefeValido_(r.u.usuario.toLowerCase(), b.jefe); r.u.activo = 'TRUE'; r.u.estado = 'activo';
    guardarUsuario_(r.T, r.i, r.u);
    var ROLN = { admin: 'Administración', gerencia: 'Gerencia', analista: 'Analista', consulta: 'Consulta' };
    var env = correo_(r.u.email, 'Tu acceso fue aprobado', 'Hola ' + r.u.nombre + ',\n\nTu acceso al dashboard fue <b>aprobado</b> con el rol <b>' + ROLN[r.u.rol] + '</b>.\nEntra con tu usuario <b>' + r.u.usuario + '</b> y la contraseña que elegiste en ' + enlace_(b.appUrl) + '.');
    return { ok: true, correo: env };
  },
  rejectUser: function (b, me) {
    soloAdmin_(me); var r = usuario_(b.usuario); if (!r) throw err_('No existe ese usuario.');
    if (r.u.estado !== 'pendiente') throw err_('Ese usuario no tiene una solicitud pendiente.');
    r.u.estado = 'rechazado'; r.u.activo = 'FALSE'; guardarUsuario_(r.T, r.i, r.u);
    var motivo = String(b.motivo || '').trim().slice(0, 300);
    var env = correo_(r.u.email, 'Tu solicitud de acceso', 'Hola ' + r.u.nombre + ',\n\nTu solicitud de acceso al dashboard <b>no fue aprobada</b>.' + (motivo ? '\nMotivo: ' + motivo.replace(/</g, '&lt;') : '') + '\nSi crees que es un error, consulta con Administración.');
    return { ok: true, correo: env };
  },
  setActive: function (b, me) { return PRIVADAS.updateUser({ usuario: b.usuario, activo: !!b.activo }, me); }
};
function rolValido_(r) { r = String(r || 'consulta'); if (ROLES.indexOf(r) < 0) throw err_('Rol no válido.'); return r; }
function jefeValido_(usuario, jefe) {
  jefe = String(jefe || '').trim().toLowerCase(); if (!jefe) return '';
  if (jefe === usuario) throw err_('Una persona no puede reportarse a sí misma.');
  var x = jefe, guard = 0;
  while (x && guard++ < 50) { var p = usuario_(x); if (!p) throw err_('La persona a quien reporta no existe.'); if (x === usuario) throw err_('Esa relación crea un círculo en la jerarquía.'); x = String(p.u.jefe || '').toLowerCase(); }
  return jefe;
}
function soloAdmin_(me) { if (rolDe_(me) !== 'admin') throw err_('Solo la cuenta de administración puede hacer esto.'); }

function manejar_(b) {
  b = b || {};
  if (PUBLICAS[b.action]) return { ok: true, data: PUBLICAS[b.action](b) };
  if (!PRIVADAS[b.action]) throw err_('Acción desconocida.');
  var me = sesionUsuario_(b.token);
  if (me.debeCambiar === 'TRUE' && b.action !== 'changePassword' && b.action !== 'ping') throw err_('DEBE_CAMBIAR');
  var libres = ['ping', 'changePassword', 'listUsers', 'addUser', 'updateUser', 'setActive', 'approveUser', 'rejectUser'];
  if (libres.indexOf(b.action) < 0 && PERMISOS[rolDe_(me)].indexOf(b.action) < 0) throw err_('Tu rol (' + rolDe_(me) + ') no permite esta acción.');
  return { ok: true, data: PRIVADAS[b.action](b, me) };
}

/* ======================= Entrada web ======================= */
function doGet() { return salida_({ ok: true, servicio: 'Dashboard de cartera GSF' }); }
function doPost(e) {
  var b = null, res;
  try { b = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { }
  if (!b) return salida_({ ok: false, error: 'Solicitud inválida.' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return salida_({ ok: false, error: 'El servidor está ocupado. Intenta de nuevo en unos segundos.' });
  try { res = manejar_(b); }
  catch (x) { res = { ok: false, error: x.usuario ? x.message : 'Error interno: ' + (x && x.message) }; }
  finally { lock.releaseLock(); }
  return salida_(res);
}
function salida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

var COLS_MESES = ['Mes', 'Etiqueta', 'Guardado', 'Préstamos', 'Cartera', 'Monto original', 'Saldo moroso', 'PAR30 %', 'PAR30 sin migrados %', 'Recaudo', 'Letras del mes', 'Meta siguiente', 'Intereses mes', 'GM mes', 'FECI saldo', 'Prima seguro', 'Cancelados', 'Detalle guardado', 'Partes JSON'];
var COLS_CLIENTES = ['Mes', 'Contrato', 'Cliente', 'Cédula', 'Sucursal', 'Producto', 'Patrono', 'Oficial', 'Tramo', 'Días mora', 'Monto', 'Saldo', 'Saldo al día', 'Moroso', 'Letra', 'Forma pago', 'Letras del mes', 'Letras mes siguiente', 'Cobrado en el mes', 'Fecha préstamo', 'Primera letra', 'Última letra', 'Último pago', 'Estado'];

/* ======================= Instalación (una vez) ======================= */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Dashboard cartera')
      .addItem('Instalar (crear pestañas)', 'instalar')
      .addItem('Permitir que un usuario cree una contraseña nueva…', 'permitirNuevaClave')
      .addToUi();
  } catch (e) { }
}
function aviso_(t, m) { try { SpreadsheetApp.getUi().alert(t, m, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { } console.log(t + ': ' + m); }
function instalar() {
  hoja_('Meses', COLS_MESES); hoja_('Clientes', COLS_CLIENTES); hoja_('Modelo', ['Mes', 'Parte', 'Datos']); hoja_('Config', ['Clave', 'Valor']);
  hoja_('Usuarios', COLS_USUARIOS); hoja_('Sesiones', COLS_SESIONES); hoja_('Archivos', COLS_ARCHIVOS);
  var ss = libro_(), def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 7) ss.deleteSheet(def);
  aviso_('Dashboard cartera', 'Listo: pestañas creadas.\n\nAhora publica el script (Implementar → Nueva implementación → Aplicación web, Ejecutar como: Yo, Acceso: Cualquier usuario) y pega la URL en index.html. ' +
    'La primera vez que abras la página te pedirá crear la cuenta de administración.');
}
/* Rescate: deja al usuario sin contraseña; al entrar, la página le pide crear una nueva. */
function permitirNuevaClave() {
  var ui = SpreadsheetApp.getUi(), r = ui.prompt('Usuario que creará una contraseña nueva', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var x = usuario_(r.getResponseText()); if (!x) { aviso_('No encontrado', 'No existe ese usuario.'); return; }
  x.u.hash = ''; x.u.salt = ''; x.u.debeCambiar = 'FALSE'; guardarUsuario_(x.T, x.i, x.u);
  sesionesBorrar_(function (s) { return s.usuario.toLowerCase() === x.u.usuario.toLowerCase(); });
  aviso_('Listo', x.u.usuario + ' podrá crear una contraseña nueva al entrar a la página.');
}

function hoja_(nombre, cols) {
  const ss = libro_();
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
  const sa = hoja_('Archivos', COLS_ARCHIVOS); borrarFilasRapido_(sa, mes);
  if (b.modelo && b.archivos && b.archivos.length) {
    const filas = [];
    b.archivos.forEach(a => partes_(String(a.data || '')).forEach((p, i) => filas.push([mes, String(a.nombre || 'reporte.xls').slice(0, 200), i + 1, p])));
    sa.getRange(sa.getLastRow() + 1, 1, filas.length, 4).setNumberFormat('@').setValues(filas);
  }
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
  const sh = libro_().getSheetByName('Meses'); if (!sh || sh.getLastRow() < 2) return [];
  const n = sh.getLastRow(), w = sh.getLastColumn(); const vals = sh.getRange(2, 1, n - 1, w).getValues();
  const base = COLS_MESES.length;
  return vals.map(r => {
    const np = Number(r[base - 1]) || 1; const txt = r.slice(base, base + np).join('');
    let agg = null; try { agg = JSON.parse(txt); } catch (e) { }
    return { month: String(r[0]), detalle: r[base - 2] === 'Sí', agg };
  }).filter(x => x.agg);
}
function leerModelo_(mes) {
  const sh = libro_().getSheetByName('Modelo'); if (!sh || sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().filter(r => String(r[0]) === String(mes)).sort((a, b) => a[1] - b[1]);
  return vals.length ? vals.map(r => r[2]).join('') : null;
}
function leerArchivos_(mes) {
  const sh = libro_().getSheetByName('Archivos'); if (!sh || sh.getLastRow() < 2) return [];
  const por = {}, orden = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().filter(r => String(r[0]) === String(mes)).forEach(r => {
    const n = String(r[1]); if (!por[n]) { por[n] = []; orden.push(n); } por[n].push([Number(r[2]), String(r[3])]);
  });
  return orden.map(n => ({ nombre: n, data: por[n].sort((a, b) => a[0] - b[0]).map(x => x[1]).join('') }));
}
function borrarMes_(mes) {
  ['Meses', 'Clientes', 'Modelo', 'Archivos'].forEach(n => { const sh = libro_().getSheetByName(n); if (sh) (n === 'Meses' ? borrarFilas_ : borrarFilasRapido_)(sh, String(mes)); });
}
function leerConfig_() {
  const sh = libro_().getSheetByName('Config'); if (!sh || sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues(); const r = vals.find(v => v[0] === 'config');
  try { return r ? JSON.parse(r[1]) : null; } catch (e) { return null; }
}
function guardarConfig_(cfg) {
  const sh = hoja_('Config', ['Clave', 'Valor']); borrarFilas_(sh, 'config');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([['config', JSON.stringify(cfg)]]);
}
