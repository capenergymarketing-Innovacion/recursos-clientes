// ---------------------------------------------------------------
// GENERADOR DE CÓDIGOS DE ACCESO · Recursos Capenergy (oct 2026)
//
// Quién entra: la identidad la decide la HOJA MADRE de altas
// (usuario CAP-XXXXXX-26 + contraseña, mismo validador que el
// panel de herramientas). Además, solo los usuarios listados en la
// variable de entorno CODIGOS_ADMIN pueden generar códigos.
//
// Variables de entorno necesarias en Netlify:
//   VALIDADOR_URL  -> URL /exec del Apps Script de la hoja madre
//   CODIGOS_ADMIN  -> usuarios autorizados, separados por comas
//
// Almacenes (Netlify Blobs):
//   "codigos-acceso"  -> un registro por código
//   "sesiones-admin"  -> sesiones del generador (8 horas)
// ---------------------------------------------------------------
const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");

// Sin 0/O, 1/I/L ni 5/S para que nadie se confunda al teclear
const ALFABETO = "ABCDEFGHJKMNPQRTUVWXYZ2346789";
const HORAS_PERMITIDAS = [2, 24, 48, 72];
const HORAS_SESION = 8;

const cabeceras = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
};
const responde = (status, datos) => ({ statusCode: status, headers: cabeceras, body: JSON.stringify(datos) });

function aleatorio(n) {
  let out = "";
  for (let i = 0; i < n; i++) out += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return out;
}
const nuevoCodigo = () => aleatorio(4) + "-" + aleatorio(4);
const normalizaUsuario = (u) => String(u || "").trim().toUpperCase();

function admins() {
  return String(process.env.CODIGOS_ADMIN || "")
    .split(",")
    .map(normalizaUsuario)
    .filter(Boolean);
}

// Pregunta a la hoja madre si usuario + contraseña son válidos
async function validarEnHojaMadre(usuario, clave) {
  const base = process.env.VALIDADOR_URL;
  if (!base) return { ok: false, motivo: "config" };
  const url =
    base +
    "?codigo=" + encodeURIComponent(usuario) +
    "&clave=" + encodeURIComponent(clave) +
    "&origen=recursos-codigos";
  const r = await fetch(url, { redirect: "follow" });
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch (e) {
    return { ok: false, motivo: "validador" };
  }
}

async function sesionValida(store, token) {
  if (!token || typeof token !== "string" || token.length < 30) return null;
  const s = await store.get(token, { type: "json" });
  if (!s) return null;
  if (Date.now() > s.expira) {
    await store.delete(token);
    return null;
  }
  return s;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return responde(405, { ok: false, motivo: "metodo" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return responde(400, { ok: false, motivo: "formato" });
  }

  connectLambda(event);
  const codigos = getStore("codigos-acceso");
  const sesiones = getStore("sesiones-admin");
  const accion = String(body.accion || "");

  // ---------- ENTRAR ----------
  if (accion === "entrar") {
    const usuario = normalizaUsuario(body.usuario);
    const clave = String(body.clave || "").trim();
    if (!usuario || !clave) return responde(400, { ok: false, motivo: "faltan_datos" });

    // Primero el permiso propio de esta herramienta (no gasta intentos en la hoja madre)
    if (!admins().includes(usuario)) return responde(403, { ok: false, motivo: "sin_permiso" });

    let v;
    try {
      v = await validarEnHojaMadre(usuario, clave);
    } catch (e) {
      return responde(502, { ok: false, motivo: "validador" });
    }
    if (!v || !v.ok) return responde(401, { ok: false, motivo: (v && v.motivo) || "no_valido", minutos: v && v.minutos });
    if (v.debeCambiar) return responde(401, { ok: false, motivo: "debe_cambiar" });

    const token = crypto.randomBytes(32).toString("hex");
    const expira = Date.now() + HORAS_SESION * 3600 * 1000;
    await sesiones.setJSON(token, { usuario, nombre: v.nombre || "", expira });
    return responde(200, { ok: true, token, nombre: v.nombre || "", expira });
  }

  // ---------- A partir de aquí hace falta sesión ----------
  const sesion = await sesionValida(sesiones, body.token);
  if (!sesion) return responde(401, { ok: false, motivo: "sesion" });

  if (accion === "salir") {
    await sesiones.delete(body.token);
    return responde(200, { ok: true });
  }

  // ---------- GENERAR ----------
  if (accion === "generar") {
    const horas = Number(body.horas);
    const nota = String(body.nota || "").trim().slice(0, 80);
    if (!HORAS_PERMITIDAS.includes(horas)) return responde(400, { ok: false, motivo: "horas" });
    if (nota.length < 3) return responde(400, { ok: false, motivo: "nota" });

    let codigo = nuevoCodigo();
    for (let i = 0; i < 5 && (await codigos.get(codigo)); i++) codigo = nuevoCodigo();

    const ahora = Date.now();
    const registro = {
      codigo,
      nota,
      descarga: body.descarga === true,
      horas,
      creado: ahora,
      expira: ahora + horas * 3600 * 1000,
      creadoPor: sesion.usuario,
    };
    await codigos.setJSON(codigo, registro);
    return responde(200, { ok: true, registro });
  }

  // ---------- LISTAR (y limpiar los caducados) ----------
  if (accion === "listar") {
    const { blobs } = await codigos.list();
    const ahora = Date.now();
    const activos = [];
    for (const b of blobs) {
      const r = await codigos.get(b.key, { type: "json" });
      if (!r) continue;
      if (ahora > r.expira) {
        await codigos.delete(b.key);
        continue;
      }
      activos.push(r);
    }
    activos.sort((a, b) => b.creado - a.creado);
    return responde(200, { ok: true, activos });
  }

  // ---------- REVOCAR ----------
  if (accion === "revocar") {
    const codigo = String(body.codigo || "").toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo)) return responde(400, { ok: false, motivo: "codigo" });
    await codigos.delete(codigo);
    return responde(200, { ok: true });
  }

  return responde(400, { ok: false, motivo: "accion" });
};
