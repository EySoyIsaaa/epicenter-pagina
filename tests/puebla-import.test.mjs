import test from "node:test";
import assert from "node:assert/strict";
import { decodeCodeFile, MAX_IMPORT_BYTES, previewCodeFile } from "../puebla2026/admin/import.js";

test("reads one code per line and normalizes and deduplicates before import", () => {
  assert.deepEqual(previewCodeFile("\uFEFFFAKE-ONE\r\n fake-one \r\nFAKE-TWO\r\n!ERROR\r\n\r\n"), {
    codes: ["FAKE-ONE", "FAKE-TWO"], records: 4, duplicates: 1, invalid: 1,
  });
});

test("extracts a named code column with quotes, delimiters, and multiline metadata", () => {
  const csv = '"Referencia","Código promocional","Comentario"\n"Primera, tanda","FAKE-ONE","Uno\nDos"\n'
    + '"Doble ""comilla""","fake-two",""\n"Sin código","",""';
  assert.deepEqual(previewCodeFile(csv), {
    codes: ["FAKE-ONE", "FAKE-TWO"], records: 3, duplicates: 0, invalid: 1,
  });
  assert.deepEqual(previewCodeFile("Fecha;Promo Code\n2026-11-22;FAKE-ONE").codes, ["FAKE-ONE"]);
  assert.deepEqual(previewCodeFile("Fecha\tCódigo\n2026-11-22\tFAKE-TWO").codes, ["FAKE-TWO"]);
});

test("rejects ambiguous columns, malformed quotes and non-ASCII code characters", () => {
  assert.throws(() => previewCodeFile("Ref,Valor\nID,FAKE-ONE"), /columna/);
  assert.throws(() => previewCodeFile("Code,Código\nFAKE-ONE,FAKE-TWO"), /columna/);
  assert.throws(() => previewCodeFile('Code,Notes\nFAKE-ONE,"unfinished'), /comilla sin cerrar/);
  assert.equal(previewCodeFile("FAKE-ßß\nFAKE-UNO").invalid, 1);
});

test("rejects oversized files, excessive row counts, and invalid text encodings", () => {
  assert.throws(() => decodeCodeFile(new ArrayBuffer(MAX_IMPORT_BYTES + 1)), /512 KiB/);
  assert.throws(() => previewCodeFile("FAKE-TEST\n".repeat(10_001)), /10,000/);
  assert.throws(() => decodeCodeFile(new Uint8Array([0xc3, 0xff]).buffer), /UTF-8/);
  assert.throws(() => previewCodeFile("\n\r"), /vacío/);
});

test("decodes UTF-8 and BOM-tagged UTF-16", () => {
  const utf8 = new TextEncoder().encode("\uFEFFCódigo\nFAKE-UNO");
  assert.deepEqual(previewCodeFile(decodeCodeFile(utf8.buffer)).codes, ["FAKE-UNO"]);
  const utf16 = Uint8Array.from([0xff, 0xfe, ...Array.from("FAKE-DOS", (letter) => [letter.charCodeAt(0), 0]).flat()]);
  assert.deepEqual(previewCodeFile(decodeCodeFile(utf16.buffer)).codes, ["FAKE-DOS"]);
});
