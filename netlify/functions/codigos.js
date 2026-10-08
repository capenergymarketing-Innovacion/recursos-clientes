// ---------------------------------------------------------------
// CÓDIGOS DE ACCESO · Recursos Capenergy · v2 (oct 2026)
//
// Identidad: la decide la HOJA MADRE de altas (usuario CAP + contraseña).
// Roles:
//   admin  -> usuarios en la variable CODIGOS_ADMIN. Crea códigos,
//             aprueba o rechaza solicitudes y revoca.
//   equipo -> cualquier otra persona activa en la hoja madre. Puede
//             entrar a ver la web (con descarga) y PEDIR códigos.
//
// Variables de entorno en Netlify:
//   VALIDADOR_URL    -> URL /exec del Apps Script de la hoja madre
//   CODIGOS_ADMIN    -> usuarios admin, separados por comas
//   ZAP_AVISO_URL    -> webhook Zapier: aviso de solicitud nueva (opcional)
//   ZAP_ENVIO_URL    -> webhook Zapier: envío del código a la persona (opcional)
//   AVISO_EMAIL      -> a quién llega el aviso (por defecto capenergymarketing@gmail.com)
//
// Almacenes (Netlify Blobs):
//   codigos-acceso  -> un registro por código (clientes y equipo)
//   solicitudes     -> peticiones de código del equipo
// ---------------------------------------------------------------
const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");

// ---------- Pases firmados (acceso de equipo y sesión del generador) ----------
// No dependen del almacén: el servidor firma el pase y lo comprueba con la misma
// clave secreta, así que vale al instante y nadie puede falsificarlo.
const SECRETO = process.env.CODIGOS_SECRET || process.env.GOOGLE_API_KEY || "";
const b64u = (s) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const desB64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
function firmarPase(tipo, datos) {
  const cuerpo = b64u(JSON.stringify({ t: tipo, ...datos }));
  const firma = crypto.createHmac("sha256", SECRETO).update(cuerpo).digest("base64url");
  return tipo.toUpperCase().slice(0, 2) + "." + cuerpo + "." + firma;
}
function leerPase(pase, tipo) {
  if (!SECRETO || typeof pase !== "string") return null;
  const partes = pase.split(".");
  if (partes.length !== 3) return null;
  const esperada = crypto.createHmac("sha256", SECRETO).update(partes[1]).digest("base64url");
  const a = Buffer.from(partes[2]), b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let d; try { d = JSON.parse(desB64u(partes[1])); } catch (e) { return null; }
  if (d.t !== tipo || !d.exp || Date.now() > d.exp) return null;
  return d;
}


const ALFABETO = "ABCDEFGHJKMNPQRTUVWXYZ2346789"; // sin 0/O, 1/I/L, 5/S
const HORAS_PERMITIDAS = [2, 24, 48, 72];
const HORAS_SESION = 8;
const HORAS_EQUIPO = 24;
const WEB = "https://capenergy-recursosclientes.netlify.app/";
const ENLACES = { "": "Toda la web", msk: "Musculoesquelético", urogine: "Uroginecología", drakarian: "Estética · DRAKARIAN", vascular: "Vascular", deporte: "Deporte", eventos: "Eventos y webinars" };
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const cabeceras = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const responde = (status, datos) => ({ statusCode: status, headers: cabeceras, body: JSON.stringify(datos) });

function aleatorio(n) {
  let out = "";
  for (let i = 0; i < n; i++) out += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return out;
}
const nuevoCodigo = () => aleatorio(4) + "-" + aleatorio(4);
const normalizaUsuario = (u) => String(u || "").trim().toUpperCase();
const limpia = (t, max) => String(t || "").replace(/[<>]/g, "").trim().slice(0, max);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const admins = () => String(process.env.CODIGOS_ADMIN || "").split(",").map(normalizaUsuario).filter(Boolean);
const enlaceDe = (clave) => (clave && ENLACES[clave] ? WEB + "?servicio=" + clave + "&solo=1" : WEB);
const fechaES = (ms) =>
  new Date(ms).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

async function validarEnHojaMadre(usuario, clave, origen) {
  const base = process.env.VALIDADOR_URL;
  if (!base) return { ok: false, motivo: "config" };
  const url = base + "?codigo=" + encodeURIComponent(usuario) + "&clave=" + encodeURIComponent(clave) + "&origen=" + origen;
  const r = await fetch(url, { redirect: "follow" });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { return { ok: false, motivo: "validador" }; }
}

async function zap(url, datos) {
  if (!url) return false;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
    return r.ok;
  } catch (e) { return false; }
}

async function crearCodigo(store, datos) {
  let codigo = nuevoCodigo();
  for (let i = 0; i < 5 && (await store.get(codigo)); i++) codigo = nuevoCodigo();
  const ahora = Date.now();
  const registro = { codigo, creado: ahora, expira: ahora + datos.horas * 3600 * 1000, ...datos };
  await store.setJSON(codigo, registro);
  return registro;
}


async function listarTodo(store) {
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: "json" });
    if (r) out.push({ key: b.key, r });
  }
  return out;
}

// ---------- Correos (HTML sencillo, compatible con Gmail) ----------
function marco(contenido) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#14202B">' +
    '<div style="background:#0A1E3D;padding:18px 24px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:bold;font-size:18px;letter-spacing:2px">CAPENERGY</span></div>' +
    '<div style="border:1px solid #E3E9EE;border-top:0;padding:26px 24px;border-radius:0 0 12px 12px">' + contenido + "</div>" +
    '<p style="font-size:11px;color:#8A97A3;text-align:center;margin-top:14px">Capenergy Medical · Sant Joan Despí (Barcelona)</p></div>';
}
function correoCodigo(s, reg) {
  const link = enlaceDe(s.enlace);
  const horas = reg.horas === 2 ? "2 horas" : reg.horas + " horas";
  const html = marco(
    '<p style="font-size:16px;margin:0 0 14px">Hola ' + esc(s.destNombre) + ",</p>" +
    '<p style="font-size:15px;line-height:1.6;margin:0 0 18px">' + esc(s.solicitanteNombre || "Tu contacto de Capenergy") +
    " te comparte el material audiovisual de Capenergy. Para verlo, abre el enlace e introduce este código:</p>" +
    '<div style="text-align:center;margin:22px 0"><div style="display:inline-block;border:2px dashed #1C6BA0;background:#EAF2F8;border-radius:12px;padding:14px 26px;font-family:Courier New,monospace;font-size:28px;font-weight:bold;letter-spacing:5px">' + reg.codigo + "</div></div>" +
    '<div style="text-align:center;margin:0 0 20px"><a href="' + link + '" style="display:inline-block;background:#1C6BA0;color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:10px">Ver el material</a></div>' +
    '<p style="font-size:13px;color:#5C6B78;line-height:1.6;margin:0">El código es personal y funciona durante ' + horas + ", hasta el " + fechaES(reg.expira) + " (hora de Madrid)." +
    (reg.descarga ? " Incluye la opción de descargar el material." : " Podrás ver y reproducir el material desde la web.") + "</p>"
  );
  return { para: s.destEmail, asunto: "Tu acceso al material de Capenergy", html };
}
function correoAviso(s) {
  const html = marco(
    '<p style="font-size:16px;margin:0 0 12px"><b>Nueva solicitud de código</b></p>' +
    '<table style="font-size:14px;line-height:1.7;border-collapse:collapse">' +
    "<tr><td style=\"color:#5C6B78;padding-right:14px\">Pide</td><td>" + esc(s.solicitanteNombre) + " (" + s.solicitante + ")</td></tr>" +
    "<tr><td style=\"color:#5C6B78;padding-right:14px\">Para</td><td>" + esc(s.destNombre) + " · " + esc(s.destEmail) + "</td></tr>" +
    "<tr><td style=\"color:#5C6B78;padding-right:14px\">Motivo</td><td>" + esc(s.motivo) + "</td></tr>" +
    "<tr><td style=\"color:#5C6B78;padding-right:14px\">Duración</td><td>" + s.horas + " horas</td></tr>" +
    "<tr><td style=\"color:#5C6B78;padding-right:14px\">Enlace</td><td>" + ENLACES[s.enlace || ""] + "</td></tr>" +
    "<tr><td style=\"color:#5C6B78;padding-right:14px\">Descarga</td><td>" + (s.descarga ? "Sí" : "No") + "</td></tr></table>" +
    '<div style="margin-top:20px"><a href="' + WEB + 'generador" style="display:inline-block;background:#1C6BA0;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">Abrir el generador para aprobarla</a></div>'
  );
  return { para: process.env.AVISO_EMAIL || "capenergymarketing@gmail.com", asunto: "Solicitud de código: " + s.destNombre + " (pide " + s.solicitanteNombre + ")", html };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return responde(405, { ok: false, motivo: "metodo" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return responde(400, { ok: false, motivo: "formato" }); }

  connectLambda(event);
  const codigos = getStore("codigos-acceso");
  const solicitudes = getStore("solicitudes");
  const accion = String(body.accion || "");

  // ---------- ENTRAR al generador (admin o equipo) / EQUIPO a la web ----------
  if (accion === "entrar" || accion === "equipo") {
    const usuario = normalizaUsuario(body.usuario);
    const clave = String(body.clave || "").trim();
    if (!usuario || !clave) return responde(400, { ok: false, motivo: "faltan_datos" });
    let v;
    try { v = await validarEnHojaMadre(usuario, clave, accion === "equipo" ? "recursos-equipo" : "recursos-codigos"); }
    catch (e) { return responde(502, { ok: false, motivo: "validador" }); }
    if (!v || !v.ok) return responde(401, { ok: false, motivo: (v && v.motivo) || "no_valido", minutos: v && v.minutos });
    if (v.debeCambiar) return responde(401, { ok: false, motivo: "debe_cambiar" });
    const nombre = v.nombre || usuario;

    if (accion === "equipo") {
      const exp = Date.now() + HORAS_EQUIPO * 3600 * 1000;
      const pase = firmarPase("equipo", { u: usuario, n: nombre, exp });
      return responde(200, { ok: true, codigo: pase, expira: exp, descarga: true, tipo: "equipo", nombre });
    }

    const rol = admins().includes(usuario) ? "admin" : "equipo";
    const expira = Date.now() + HORAS_SESION * 3600 * 1000;
    const token = firmarPase("sesion", { u: usuario, n: nombre, exp: expira });
    return responde(200, { ok: true, token, nombre, rol, expira });
  }

  // ---------- EQUIPO dentro de la web: compartir con un cliente ----------
  // Lo autoriza el propio acceso de equipo (24 h, creado con su usuario CAP validado por la hoja madre).
  if (accion === "compartir") {
    const p = leerPase(String(body.acceso || ""), "equipo");
    if (!p) return responde(401, { ok: false, motivo: "sin_acceso_equipo" });
    const mio = { creadoPor: p.u, creadoPorNombre: p.n };
    const nota = limpia(body.nota, 80);
    const horas = Number(body.horas);
    const enlace = ENLACES[body.enlace] !== undefined ? String(body.enlace || "") : null;
    const errores = [];
    if (nota.length < 3) errores.push("nota");
    if (!HORAS_PERMITIDAS.includes(horas)) errores.push("horas");
    if (enlace === null) errores.push("enlace");
    if (errores.length) return responde(400, { ok: false, motivo: "campos", errores });
    const reg = await crearCodigo(codigos, {
      horas, nota, descarga: body.descarga === true, tipo: "cliente", enlace,
      creadoPor: mio.creadoPor, creadoPorNombre: mio.creadoPorNombre || mio.creadoPor,
    });
    const link = enlaceDe(enlace);
    const durac = horas === 2 ? "2 horas" : horas + " horas";
    const mensaje = "Hola, te comparto el material de Capenergy:\n" + link + "\n\nPara entrar, introduce este código: " + reg.codigo + "\nEl código es personal y funciona durante " + durac + ".";
    return responde(200, { ok: true, registro: reg, enlace: link, mensaje });
  }

  // ---------- A partir de aquí hace falta sesión ----------
  const ps = leerPase(String(body.token || ""), "sesion");
  if (!ps) return responde(401, { ok: false, motivo: "sesion" });
  const sesion = { usuario: ps.u, nombre: ps.n };
  const esAdmin = admins().includes(sesion.usuario); // se comprueba en cada llamada contra CODIGOS_ADMIN

  if (accion === "salir") return responde(200, { ok: true });

  // ---------- EQUIPO (y admin): pedir un código ----------
  if (accion === "solicitar") {
    const s = {
      destNombre: limpia(body.destNombre, 80),
      destEmail: limpia(body.destEmail, 120).toLowerCase(),
      motivo: limpia(body.motivo, 200),
      horas: Number(body.horas),
      enlace: ENLACES[body.enlace] !== undefined ? String(body.enlace || "") : null,
      descarga: body.descarga === true,
    };
    const errores = [];
    if (s.destNombre.length < 2) errores.push("destNombre");
    if (!RE_EMAIL.test(s.destEmail)) errores.push("destEmail");
    if (s.motivo.length < 5) errores.push("motivo");
    if (!HORAS_PERMITIDAS.includes(s.horas)) errores.push("horas");
    if (s.enlace === null) errores.push("enlace");
    if (errores.length) return responde(400, { ok: false, motivo: "campos", errores });

    const id = Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
    const sol = { id, ...s, solicitante: sesion.usuario, solicitanteNombre: sesion.nombre, estado: "pendiente", creado: Date.now() };
    await solicitudes.setJSON(id, sol);
    const avisado = await zap(process.env.ZAP_AVISO_URL, { tipo: "aviso", ...correoAviso(sol) });
    return responde(200, { ok: true, solicitud: sol, avisado });
  }

  if (accion === "mis_solicitudes") {
    const todas = await listarTodo(solicitudes);
    const mias = todas.map((x) => x.r).filter((r) => r.solicitante === sesion.usuario)
      .sort((a, b) => b.creado - a.creado).slice(0, 30)
      .map(({ codigo, ...resto }) => resto); // el código va solo a la persona final
    return responde(200, { ok: true, solicitudes: mias });
  }

  // ---------- Solo admin desde aquí ----------
  if (!esAdmin) return responde(403, { ok: false, motivo: "sin_permiso" });

  if (accion === "generar") {
    const horas = Number(body.horas);
    const nota = limpia(body.nota, 80);
    if (!HORAS_PERMITIDAS.includes(horas)) return responde(400, { ok: false, motivo: "horas" });
    if (nota.length < 3) return responde(400, { ok: false, motivo: "nota" });
    const registro = await crearCodigo(codigos, { horas, nota, descarga: body.descarga === true, tipo: "cliente", creadoPor: sesion.usuario });
    return responde(200, { ok: true, registro });
  }

  if (accion === "pendientes") {
    const todas = await listarTodo(solicitudes);
    const limite = Date.now() - 30 * 24 * 3600 * 1000;
    for (const x of todas) if (x.r.estado !== "pendiente" && x.r.creado < limite) await solicitudes.delete(x.key); // limpieza > 30 días
    const pend = todas.map((x) => x.r).filter((r) => r.estado === "pendiente").sort((a, b) => a.creado - b.creado);
    return responde(200, { ok: true, pendientes: pend });
  }

  if (accion === "aprobar" || accion === "rechazar") {
    const id = String(body.id || "");
    const sol = id ? await solicitudes.get(id, { type: "json" }) : null;
    if (!sol) return responde(404, { ok: false, motivo: "no_existe" });
    if (sol.estado !== "pendiente") return responde(409, { ok: false, motivo: "ya_resuelta", estado: sol.estado });

    if (accion === "rechazar") {
      sol.estado = "rechazada"; sol.resuelto = Date.now(); sol.resueltoPor = sesion.usuario;
      await solicitudes.setJSON(id, sol);
      return responde(200, { ok: true, solicitud: sol });
    }

    const descarga = typeof body.descarga === "boolean" ? body.descarga : sol.descarga;
    const reg = await crearCodigo(codigos, {
      horas: sol.horas, descarga, tipo: "cliente",
      nota: sol.destNombre + " (pide " + sol.solicitanteNombre + ")", creadoPor: sesion.usuario, solicitud: id,
    });
    const correo = correoCodigo(sol, reg);
    const enviado = await zap(process.env.ZAP_ENVIO_URL, { tipo: "envio", ...correo });
    sol.estado = "aprobada"; sol.descarga = descarga; sol.resuelto = Date.now(); sol.resueltoPor = sesion.usuario;
    sol.enviado = enviado; sol.expira = reg.expira; sol.codigo = reg.codigo;
    await solicitudes.setJSON(id, sol);
    return responde(200, { ok: true, registro: reg, enviado, mensaje: "Hola " + sol.destNombre + ", te comparto el material de Capenergy:\n" + enlaceDe(sol.enlace) + "\n\nPara entrar, introduce este código: " + reg.codigo + "\nEl código es personal y funciona durante " + sol.horas + " horas." });
  }

  if (accion === "listar") {
    const todas = await listarTodo(codigos);
    const ahora = Date.now();
    const activos = [];
    for (const x of todas) {
      if (ahora > x.r.expira) { await codigos.delete(x.key); continue; }
      activos.push(x.r);
    }
    activos.sort((a, b) => b.creado - a.creado);
    return responde(200, { ok: true, activos });
  }

  if (accion === "revocar") {
    const codigo = String(body.codigo || "").toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo)) return responde(400, { ok: false, motivo: "codigo" });
    await codigos.delete(codigo);
    return responde(200, { ok: true });
  }

  return responde(400, { ok: false, motivo: "accion" });
};
