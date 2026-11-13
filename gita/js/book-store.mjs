/* The owner's copy of the book, kept only on this device.
   importPdf() reads her PDF with the vendored pdf.js and the shared parser; the parsed book
   is saved in IndexedDB. resolve() turns a content pointer into paragraphs, using the
   short anchor to recover if a paragraph index ever shifts. */
import { normalizePage, parseBook } from "./book-parser.mjs";

const DB_NAME = "gita";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("scenes")) db.createObjectStore("scenes"); // day -> latest image
      if (!db.objectStoreNames.contains("gallery"))
        db.createObjectStore("gallery", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbRun(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && "result" in result ? result.result : result);
    tx.onerror = () => reject(tx.error);
  });
}

export const kvGet = (key) => dbRun("kv", "readonly", (s) => s.get(key));
export const kvSet = (key, value) => dbRun("kv", "readwrite", (s) => s.put(value, key));

let cached = null;
export async function loadBook() {
  if (cached) return cached;
  cached = (await kvGet("book")) || null;
  return cached;
}

/** Read the PDF on this device, parse it, check it, and save it. */
export async function importPdf(file, onProgress = () => {}) {
  const pdfjs = await import("../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../vendor/pdfjs/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    pages.push(normalizePage(await (await pdf.getPage(n)).getTextContent()));
    if (n % 10 === 0 || n === pdf.numPages) onProgress(n, pdf.numPages);
  }
  await pdf.destroy();
  const book = parseBook(pages);
  const chapters = Object.keys(book.chapters).length;
  if (chapters !== 18)
    throw new Error(`This PDF does not look like the Holy Geeta (found ${chapters} chapters).`);
  book.importedAt = new Date().toISOString();
  await kvSet("book", book);
  cached = book;
  return book;
}

const words = (t) =>
  String(t || "")
    .split(/\s+/)
    .filter(Boolean);
const startsWith = (text, anchor) =>
  words(text).slice(0, words(anchor).length).join(" ") === anchor;

function list(book, ptr) {
  if (ptr.part === "generalIntro") return book.generalIntro;
  const ch = book.chapters[ptr.c];
  if (!ch) return [];
  if (ptr.part === "closing") return ch.closing;
  if (ptr.part === "link") return [ch.verses[ptr.v]?.linkLine];
  if (ptr.part === "translation") return [ch.verses[ptr.v]?.translation];
  return ch.verses[ptr.v]?.commentary || [];
}

/** Paragraphs for a pointer. If the first paragraph's anchor doesn't match (the device
    parsed a paragraph differently), shift to where the anchor is found. */
export function resolve(book, ptr) {
  const paras = list(book, ptr);
  if (ptr.part === "link" || ptr.part === "translation") return paras.filter(Boolean);
  let indices = ptr.p || [];
  if (ptr.a && indices.length && !startsWith(paras[indices[0]], ptr.a)) {
    const found = paras.findIndex((t) => startsWith(t, ptr.a));
    if (found >= 0) indices = indices.map((i) => i + (found - indices[0]));
  }
  return indices.map((i) => paras[i]).filter(Boolean);
}

/** How many content pointers match the parsed book exactly (shown in Settings). */
export function integrity(book, days) {
  let total = 0;
  let exact = 0;
  const check = (ptr) => {
    total++;
    const paras = list(book, ptr);
    const first = ptr.p ? paras[ptr.p[0]] : paras[0];
    if (first && (!ptr.a || startsWith(first, ptr.a))) exact++;
  };
  for (const d of days) {
    if (d.intro) check(d.intro);
    d.words.forEach(check);
    d.thread.filter((t) => t.by === "his").forEach(check);
  }
  return { total, exact };
}

/** All commentary of the day's verses, for "Read his full commentary". */
export function fullCommentary(book, day) {
  return day.full
    .flatMap(({ c, v }) => book.chapters[c]?.verses[v]?.commentary || [])
    .filter((t) => words(t).length >= 3);
}

export function translation(book, chapter, verse) {
  const ch = book.chapters[chapter];
  const key = ch?.verseIndex[verse];
  return key ? ch.verses[key].translation : "";
}
