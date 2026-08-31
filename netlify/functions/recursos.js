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
  const especialidad = (event.queryStringParameters || {}).especialidad;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  };

  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Falta la API key" }) };
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

    const fotos = fotosRaw.map((f) => ({
      id: f.id,
      nombre: f.name,
      view: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1200`,
      open: `https://drive.google.com/file/d/${f.id}/view`,
      dl: `https://drive.google.com/uc?export=download&id=${f.id}`,
    }));

    const videos = videosRaw.map((v) => ({
      id: v.id,
      titulo: sinExtension(v.name),
      embed: `https://drive.google.com/file/d/${v.id}/preview`,
      open: `https://drive.google.com/file/d/${v.id}/view`,
      dl: `https://drive.google.com/uc?export=download&id=${v.id}`,
    }));

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
      body: JSON.stringify({ especialidad, fotos, videos, testimonios }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No se pudo leer Drive", detalle: String(e) }),
    };
  }
};
