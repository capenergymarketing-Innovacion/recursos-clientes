const CARPETAS = {
  msk: {
    fotos: "1JT5IhLzdbKsiy3pBKqjQOJNEladZ-pHr",
    videos: "1OoQRW5YCTOOccCvpgkkttB3L6d1B_X2W",
  },
  urogine: {
    fotos: "1PEdLIMvu03IOCvhx1ugdZdquwl4VGht8",
    videos: "1vR6-w3Fh99oRvdGmok-FPgDYJDDrVEbs",
  },
  drakarian: {
    fotos: "1gksWqXD8EorxKGJ-VElMgE103_ry1SMU",
    videos: "1qenPaYN9VBNn5osZEVd5bWCdc4EjaQEw",
  },
};

async function listarCarpeta(folderId, apiKey) {
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
    const [fotosRaw, videosRaw] = await Promise.all([
      listarCarpeta(carpeta.fotos, apiKey),
      listarCarpeta(carpeta.videos, apiKey),
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
      titulo: v.name.replace(/\.(mp4|mov|webm|avi|m4v)$/i, ""),
      embed: `https://drive.google.com/file/d/${v.id}/preview`,
      open: `https://drive.google.com/file/d/${v.id}/view`,
      dl: `https://drive.google.com/uc?export=download&id=${v.id}`,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ especialidad, fotos, videos }) };
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "No se pudo leer Drive", detalle: String(e) }),
    };
  }
};
