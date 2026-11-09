export const MAX_IMPORT_BYTES = 512 * 1024;
const MAX_RECORDS = 10_000;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,63}$/;
const CODE_HEADERS = new Set([
  "code", "codes", "promo code", "promo codes", "promotion code", "promotional code",
  "redemption code", "redeem code", "offer code", "offer codes", "app promo code",
  "codigo", "codigos", "codigo promocional", "codigos promocionales",
  "codigo de promocion", "codigo de canje", "codigo de oferta",
]);

export function decodeCodeFile(buffer) {
  if (buffer.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("El archivo excede 512 KiB.");
  }
  const [first, second] = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  const encoding = first === 0xff && second === 0xfe ? "utf-16le"
    : first === 0xfe && second === 0xff ? "utf-16be" : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Guarda el archivo como texto UTF-8 o UTF-16 con BOM.");
  }
}

function detectSeparator(text) {
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "\n") break;
    if (counts.has(char)) counts.set(char, counts.get(char) + 1);
  }
  return [...counts].reduce((best, [char, count]) => count > counts.get(best) ? char : best, ",");
}

function parseRecords(text, separator) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index] ?? "\n";
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
        closedQuote = true;
      }
      continue;
    }

    if (char === separator || char === "\n") {
      record.push(field);
      field = "";
      closedQuote = false;
      if (char === "\n") {
        if (record.some((value) => value.trim())) records.push(record);
        record = [];
        if (records.length > MAX_RECORDS + 1) break;
      }
    } else if (closedQuote) {
      if (char !== " " && char !== "\t") {
        throw new Error("El CSV contiene caracteres después de un campo entre comillas.");
      }
    } else if (char === '"' && !field.trim()) {
      field = "";
      quoted = true;
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("El CSV contiene una comilla sin cerrar.");
  return records;
}

function headerName(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function previewCodeFile(input) {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("El archivo está vacío.");
  const records = parseRecords(text, detectSeparator(text));
  if (!records.length) throw new Error("El archivo está vacío.");
  const headers = records[0].map((value) => CODE_HEADERS.has(headerName(value)));
  const column = headers.indexOf(true);
  if (headers.filter(Boolean).length > 1 || (column < 0 && records.some((row) => row.length > 1))) {
    throw new Error("Usa una sola columna llamada Código o Promo Code para identificar los códigos.");
  }

  const rows = column < 0 ? records : records.slice(1);
  if (rows.length > MAX_RECORDS) throw new Error("El archivo excede 10,000 registros.");
  const codes = new Set();
  let invalid = 0;
  let duplicates = 0;
  for (const row of rows) {
    const value = row[Math.max(column, 0)]?.trim() ?? "";
    if (!/^[A-Za-z0-9-]+$/.test(value) || !CODE_PATTERN.test(value.toUpperCase())) {
      invalid += 1;
      continue;
    }
    const code = value.toUpperCase();
    if (codes.has(code)) duplicates += 1;
    codes.add(code);
  }
  return { codes: [...codes], records: rows.length, invalid, duplicates };
}
