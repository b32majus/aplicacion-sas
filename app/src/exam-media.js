// Extensión multimedia del paquete canónico (unidad m05-casos-multimedia).
//
// El esquema histórico `schemas/exam.schema.json` no se toca: esta capa añade,
// solo cuando el paquete nuevo la declara, un bloque `media` con assets
// inmutables y agrupaciones de caso, y por pregunta `caseId` y referencias
// exactas y ordenadas `{ asset, alt }`. Todo es no-op para los paquetes que no
// declaran `media`, de modo que los doce exámenes Admin y sus consumidores M04
// conservan exactamente su comportamiento.

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/gif"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const SPOILER_PATTERN = /(respuesta|correcta|soluci[oó]n|spoiler)/i;
// Misma política que el patrón de `schemas/exam-media.schema.json`: solo
// segmentos relativos simples y una extensión de imagen. Rechaza `%2e%2e`,
// `%2f`, barras invertidas, esquemas y segmentos vacíos antes de tocar la red.
const SAFE_ASSET_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.(?:png|jpg|jpeg|gif)$/;

function isSafeAssetPath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!SAFE_ASSET_PATH_PATTERN.test(value)) return false;
  // Defensa en profundidad: ningún segmento (ni su forma decodificada) puede
  // ser `.` o `..` ni contener separadores.
  return value.split("/").every((segment) => {
    if (segment === "." || segment === ".." || segment === "") return false;
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    return decoded !== "." && decoded !== ".."
      && !decoded.includes("/") && !decoded.includes("\\");
  });
}

function assetById(pkg) {
  const map = new Map();
  for (const asset of pkg?.media?.assets ?? []) {
    if (asset && typeof asset.id === "string" && asset.id) map.set(asset.id, asset);
  }
  return map;
}

function validateAlt(alt, context) {
  if (typeof alt !== "string" || !alt.trim()) {
    throw new Error(`${context}: el texto alternativo (alt) es obligatorio y debe ser descriptivo.`);
  }
  if (SPOILER_PATTERN.test(alt)) {
    throw new Error(`${context}: el texto alternativo (alt) no debe revelar la solución ni contener spoilers.`);
  }
}

// Validación estructural de la extensión. No descarga nada: comprueba rutas
// internas seguras, MIME permitido, dimensiones enteras positivas, SHA-256,
// origen y versión trazables, referencias exactas y alt sin spoilers.
export function validatePackageMedia(pkg) {
  const media = pkg?.media;
  if (media == null) return;

  if (typeof media !== "object" || Array.isArray(media)) {
    throw new Error(`El examen ${pkg?.id || "(sin id)"} declara una extensión multimedia inválida.`);
  }
  if (!Array.isArray(media.assets)) {
    throw new Error(`El examen ${pkg.id} debe declarar media.assets como una lista de imágenes.`);
  }

  const assets = new Map();
  for (const [index, asset] of media.assets.entries()) {
    const label = `El asset ${index + 1} del examen ${pkg.id}`;
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      throw new Error(`${label} no es una declaración válida.`);
    }
    if (typeof asset.id !== "string" || !asset.id.trim()) {
      throw new Error(`${label} exige un id estable.`);
    }
    if (assets.has(asset.id)) {
      throw new Error(`${label} repite el id "${asset.id}".`);
    }
    if (!isSafeAssetPath(asset.path)) {
      throw new Error(`${label} (${asset.id}) tiene una ruta insegura: solo se admite una ruta interna relativa, sin "..", sin rutas absolutas y sin URL remotas.`);
    }
    if (typeof asset.mime !== "string" || !ALLOWED_MIME.has(asset.mime)) {
      throw new Error(`${label} (${asset.id}) declara un MIME no permitido: se admite image/png, image/jpeg o image/gif.`);
    }
    if (!Number.isInteger(asset.width) || asset.width <= 0 || !Number.isInteger(asset.height) || asset.height <= 0) {
      throw new Error(`${label} (${asset.id}) exige dimensiones enteras positivas.`);
    }
    if (typeof asset.sha256 !== "string" || !SHA256_PATTERN.test(asset.sha256)) {
      throw new Error(`${label} (${asset.id}) exige un SHA-256 de 64 dígitos hexadecimales.`);
    }
    if (typeof asset.source !== "string" || !asset.source.trim()) {
      throw new Error(`${label} (${asset.id}) exige un origen (source) trazable.`);
    }
    if (typeof asset.version !== "string" || !asset.version.trim()) {
      throw new Error(`${label} (${asset.id}) exige la versión a la que pertenece.`);
    }
    assets.set(asset.id, asset);
  }

  const cases = new Map();
  if (media.cases != null) {
    if (!Array.isArray(media.cases)) {
      throw new Error(`El examen ${pkg.id} debe declarar media.cases como una lista de casos.`);
    }
    for (const [index, group] of media.cases.entries()) {
      const label = `El caso ${index + 1} del examen ${pkg.id}`;
      if (!group || typeof group !== "object" || Array.isArray(group) || typeof group.id !== "string" || !group.id.trim()) {
        throw new Error(`${label} exige un id estable.`);
      }
      if (cases.has(group.id)) throw new Error(`${label} repite el id "${group.id}".`);
      if (group.assets != null) {
        if (!Array.isArray(group.assets)) throw new Error(`${label} debe declarar assets como lista.`);
        for (const assetId of group.assets) {
          if (!assets.has(assetId)) {
            throw new Error(`${label} referencia un asset inexistente: ${assetId}.`);
          }
        }
      }
      cases.set(group.id, group);
    }
  }

  for (const question of pkg.questions ?? []) {
    const label = `La pregunta ${question?.id || question?.sourceNumber || "(sin id)"} del examen ${pkg.id}`;
    if (question?.caseId != null) {
      if (typeof question.caseId !== "string" || !question.caseId.trim() || !cases.has(question.caseId)) {
        throw new Error(`${label} referencia un caso inexistente: ${question.caseId}.`);
      }
    }
    if (question?.media == null) continue;
    if (!Array.isArray(question.media)) {
      throw new Error(`${label} debe declarar media como lista ordenada de referencias.`);
    }
    for (const [index, reference] of question.media.entries()) {
      if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
        throw new Error(`${label} contiene una referencia de media inválida en la posición ${index + 1}.`);
      }
      if (typeof reference.asset !== "string" || !assets.has(reference.asset)) {
        throw new Error(`${label} referencia un asset inexistente: ${reference.asset}.`);
      }
      validateAlt(reference.alt, `${label}, imagen ${index + 1}`);
    }
  }
}

// Firma de los formatos de imagen admitidos a partir de sus magic bytes.
function imageSignature(bytes) {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "image/gif";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function pngDimensions(bytes) {
  if (bytes.length < 24) return null;
  const length = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
  if (length < 13) return null;
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== "IHDR") return null;
  const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
  const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  return { width, height };
}

function gifDimensions(bytes) {
  if (bytes.length < 10) return null;
  return {
    width: bytes[6] | (bytes[7] << 8),
    height: bytes[8] | (bytes[9] << 8),
  };
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = readUint16BE(bytes, offset);
    if (length < 2) return null;
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (offset + 6 >= bytes.length) return null;
      return {
        width: readUint16BE(bytes, offset + 5),
        height: readUint16BE(bytes, offset + 3),
      };
    }
    offset += length;
  }
  return null;
}

function imageInfo(bytes) {
  const mime = imageSignature(bytes);
  if (!mime) return null;
  const dimensions = mime === "image/png"
    ? pngDimensions(bytes)
    : mime === "image/gif" ? gifDimensions(bytes) : jpegDimensions(bytes);
  if (!dimensions || !dimensions.width || !dimensions.height) return null;
  return { mime, ...dimensions };
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function joinUrl(bankBaseUrl, path) {
  if (!isSafeAssetPath(path)) {
    throw new Error(`La ruta del asset "${path}" no es una ruta interna relativa segura: se rechazan "..", rutas absolutas, URL remotas y traversal codificado.`);
  }
  const origin = globalThis.location?.href || "http://localhost/";
  const base = new URL(String(bankBaseUrl), origin);
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  const url = new URL(path, base);
  // La URL normalizada debe permanecer dentro del banco: ninguna variante
  // codificada puede escapar de /data/exams/ antes de descargar o resolver.
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error(`La ruta del asset "${path}" escapa del banco de exámenes (ruta insegura).`);
  }
  const baseString = String(bankBaseUrl);
  return `${baseString.endsWith("/") ? baseString : `${baseString}/`}${path}`;
}

// Verificación de integridad real: cada asset se descarga y debe existir, su
// SHA-256 debe coincidir, sus magic bytes deben corresponder al MIME declarado
// y sus dimensiones reales deben ser las declaradas. Un paquete sin media no
// realiza ninguna petición.
export async function verifyPackageMedia(pkg, fetchImpl, bankBaseUrl) {
  if (pkg?.media == null) return;
  validatePackageMedia(pkg);
  for (const asset of pkg.media.assets) {
    const label = `El asset "${asset.id}" del examen "${pkg.id}"`;
    const url = joinUrl(bankBaseUrl, asset.path);
    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      throw new Error(`${label} no está disponible: ${error?.message || "error de red"}.`);
    }
    if (!response?.ok) {
      throw new Error(`${label} no está disponible (asset ausente, estado ${response?.status ?? "desconocido"}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await sha256Hex(bytes);
    if (digest.toLowerCase() !== asset.sha256.toLowerCase()) {
      throw new Error(`${label} no supera la verificación de integridad: el SHA-256 servido no coincide.`);
    }
    const info = imageInfo(bytes);
    if (!info) {
      throw new Error(`${label} no es una imagen verificable (magic bytes no reconocidos).`);
    }
    if (info.mime !== asset.mime) {
      throw new Error(`${label} declara el MIME ${asset.mime}, pero los bytes servidos son ${info.mime}.`);
    }
    if (info.width !== asset.width || info.height !== asset.height) {
      throw new Error(`${label} declara ${asset.width}x${asset.height}, pero sus dimensiones reales son ${info.width}x${info.height}.`);
    }
  }
}

// Resolución ordenada contra el paquete de origen: nunca contra el catálogo
// actual ni contra otro examen. Una pregunta sin referencias devuelve null.
export function resolveQuestionMedia(question, pkg, bankBaseUrl) {
  if (!Array.isArray(question?.media) || question.media.length === 0) return null;
  if (!Array.isArray(pkg?.media?.assets)) {
    throw new Error(`La pregunta ${question.id || "(sin id)"} declara media, pero el examen ${pkg?.id || "(sin id)"} no tiene extensión multimedia.`);
  }
  const assets = assetById(pkg);
  return question.media.map((reference) => {
    const asset = assets.get(reference?.asset);
    if (!asset) {
      throw new Error(`La pregunta ${question.id || "(sin id)"} referencia un asset inexistente en el examen ${pkg.id}: ${reference?.asset}.`);
    }
    return {
      assetId: asset.id,
      url: joinUrl(bankBaseUrl, asset.path),
      alt: reference.alt,
      width: asset.width,
      height: asset.height,
    };
  });
}
