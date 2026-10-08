// ---------------------------------------------------------------
// ACCESO CON CÓDIGO (oct 2026)
// Toda la web exige un código temporal generado desde /generador.
// Los códigos viven en Netlify Blobs (almacén "codigos-acceso").
// Sin código válido esta función NO devuelve ningún archivo.
// ---------------------------------------------------------------
const { getStore, connectLambda } = require("@netlify/blobs");

function normalizarCodigo(c) {
  const limpio = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (limpio.length !== 8) return "";
  return limpio.slice(0, 4) + "-" + limpio.slice(4);
}

async function comprobarCodigo(event) {
  const h = event.headers || {};
  const codigo = normalizarCodigo(h["x-codigo-acceso"] || h["X-Codigo-Acceso"]);
  if (!codigo) return { ok: false, motivo: "sin_codigo" };
  connectLambda(event);
  const store = getStore({ name: "codigos-acceso", consistency: "strong" }); // lo recién guardado se ve al instante
  const datos = await store.get(codigo, { type: "json" });
  if (!datos) return { ok: false, motivo: "no_valido" };
  if (Date.now() > datos.expira) return { ok: false, motivo: "caducado" };
  return { ok: true, codigo, expira: datos.expira, descarga: !!datos.descarga, tipo: datos.tipo || "cliente" };
}

// Sin permiso de descarga se quitan los enlaces a Drive (Abrir y Descargar).
function sinDescarga(lista) {
  return (lista || []).map((x) => {
    const { dl, open, ...resto } = x;
    return resto;
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const CARPETAS = {
  msk: {
    fotos: "1JT5IhLzdbKsiy3pBKqjQOJNEladZ-pHr",
    videos: "1OoQRW5YCTOOccCvpgkkttB3L6d1B_X2W",
    testimonios: "1YKXbUB2_pY0dAJyBRfzWQ6T5PE_bH52k",
  },
  urogine: {
    fotos: "1PEdLIMvu03IOCvhx1ugdZdquwl4VGht8",
    videos: "1vR6-w3Fh99oRvdGmok-FPgDYJDDrVEbs",
    testimonios: "1VLu1qouGB_dijoTTtncViFS9F2V2bJQU",
  },
  drakarian: {
    fotos: "1gksWqXD8EorxKGJ-VElMgE103_ry1SMU",
    videos: "1qenPaYN9VBNn5osZEVd5bWCdc4EjaQEw",
    testimonios: "1NAGKerWccZBUWf3l-R5Z2AbGnfzH8pZN",
  },
  vascular: {
    fotos: "1aYryQSEo_j5u87Rpn2n1ISvUk7fOGa8b",
    videos: "1Wor2fcPoVmm3qzvZnOFT6P4SjKc87BwB",
    testimonios: "18IT9rhNTfeUX5p2-K8hvXuLgJtayJ6a_",
  },
  deporte: {
    fotos: "1tWxyPh2roeIO9kYGq8y8ce3_IDuWGAH1",
    videos: "10TZFOIfuYZEAKHWVSVOUezTMjKlIvmRr",
    testimonios: "1coGlVzEfp_WTvTxyZL3jTLo6tooOONEm",
  },
};

// Carpeta "Eventos y Ferias": cada subcarpeta es un evento (FISIOEXPO 2026, Congreso Milán...).
// Para añadir un evento nuevo basta con crear una subcarpeta dentro en Drive: no hay que tocar código.
const EVENTOS_ID = "1Dj2AZ_vK7UTcMG3m-6zJArqPxx3uJpR2";

async function listarSubcarpetas(folderId, apiKey) {
  const campos = "files(id,name,createdTime)";
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`
  );
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&key=${apiKey}&fields=${encodeURIComponent(campos)}` +
    `&pageSize=200&orderBy=createdTime desc`;
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Drive API ${r.status}: ${txt}`);
  }
  const data = await r.json();
  return data.files || [];
}

function mapFoto(f) {
  return {
    id: f.id,
    nombre: f.name,
    view: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1200`,
    open: `https://drive.google.com/file/d/${f.id}/view`,
    dl: `https://drive.google.com/uc?export=download&id=${f.id}`,
  };
}

function mapVideo(v) {
  return {
    id: v.id,
    titulo: sinExtension(v.name),
    embed: `https://drive.google.com/file/d/${v.id}/preview`,
    open: `https://drive.google.com/file/d/${v.id}/view`,
    dl: `https://drive.google.com/uc?export=download&id=${v.id}`,
  };
}

async function leerEventos(apiKey) {
  const subcarpetas = await listarSubcarpetas(EVENTOS_ID, apiKey);
  const eventos = await Promise.all(
    subcarpetas.map(async (sc) => {
      const archivos = await listarCarpeta(sc.id, apiKey);
      return {
        id: sc.id,
        nombre: sc.name.trim(),
        fotos: archivos.filter((a) => a.mimeType.startsWith("image/")).map(mapFoto),
        videos: archivos.filter((a) => a.mimeType.startsWith("video/")).map(mapVideo),
      };
    })
  );
  return eventos;
}

async function listarCarpeta(folderId, apiKey) {
  if (!folderId) return [];
  const campos = "files(id,name,mimeType)";
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&key=${apiKey}&fields=${encodeURIComponent(campos)}` +
    `&pageSize=1000&orderBy=name`;
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Drive API ${r.status}: ${txt}`);
  }
  const data = await r.json();
  return (data.files || []).filter(
    (f) => f.mimeType && (f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/"))
  );
}

function sinExtension(nombre) {
  return nombre.replace(/\.(mp4|mov|webm|avi|m4v)$/i, "");
}

// Lee el prefijo PAC_ / CLI_ y devuelve tipo + titulo limpio.
// Sin prefijo -> tipo "otro": el video sigue apareciendo en "Todos".
function clasificar(nombre) {
  const limpio = sinExtension(nombre);
  const m = limpio.match(/^\s*(PAC|CLI)[_\-\s]+(.*)$/i);
  if (m) {
    return { tipo: m[1].toLowerCase(), titulo: m[2].trim() || limpio };
  }
  return { tipo: "otro", titulo: limpio };
}

exports.handler = async (event) => {
  const apiKey = process.env.GOOGLE_API_KEY;
  const qs = event.queryStringParameters || {};
  const especialidad = qs.especialidad;

  // Respuesta privada: nunca se guarda en caché compartida
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  };

  // 1) Puerta: comprobar el código antes de nada
  let acceso;
  try {
    acceso = await comprobarCodigo(event);
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "No se pudo comprobar el código" }) };
  }
  if (!acceso.ok) {
    if (acceso.motivo !== "sin_codigo") await esperar(600); // frena a quien prueba códigos al azar
    return { statusCode: 401, headers, body: JSON.stringify({ error: "acceso", motivo: acceso.motivo }) };
  }
  if (qs.accion === "verificar") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, expira: acceso.expira, descarga: acceso.descarga, tipo: acceso.tipo }),
    };
  }

  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Falta la API key" }) };
  }
  if (especialidad === "eventos") {
    try {
      let eventos = await leerEventos(apiKey);
      if (!acceso.descarga) {
        eventos = eventos.map((ev) => ({ ...ev, fotos: sinDescarga(ev.fotos), videos: sinDescarga(ev.videos) }));
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ especialidad, eventos, fotos: [], videos: [], testimonios: [] }),
      };
    } catch (e) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "No se pudo leer Drive", detalle: String(e) }),
      };
    }
  }

  if (!especialidad || !CARPETAS[especialidad]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Especialidad no valida" }) };
  }

  try {
    const carpeta = CARPETAS[especialidad];
    const [fotosRaw, videosRaw, testimoniosRaw] = await Promise.all([
      listarCarpeta(carpeta.fotos, apiKey),
      listarCarpeta(carpeta.videos, apiKey),
      listarCarpeta(carpeta.testimonios, apiKey),
    ]);

    const fotos = fotosRaw.map(mapFoto);
    const videos = videosRaw.map(mapVideo);

    const testimonios = testimoniosRaw.map((t) => {
      const c = clasificar(t.name);
      return {
        id: t.id,
        titulo: c.titulo,
        tipo: c.tipo,
        embed: `https://drive.google.com/file/d/${t.id}/preview`,
        open: `https://drive.google.com/file/d/${t.id}/view`,
        dl: `https://drive.google.com/uc?export=download&id=${t.id}`,
      };
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(
        acceso.descarga
          ? { especialidad, fotos, videos, testimonios }
          : {
              especialidad,
              fotos: sinDescarga(fotos),
              videos: sinDescarga(videos),
              testimonios: sinDescarga(testimonios),
            }
      ),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No se pudo leer Drive", detalle: String(e) }),
    };
  }
};
