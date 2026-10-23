/* Parses the owner's copy of Swami Chinmayananda's "Holy Geeta" into chapters, verses
   and paragraphs. The SAME module runs in the browser (vendored pdf.js) and in Node
   (pdfjs-dist), so paragraph indices stored in the content files point to the same
   text everywhere. No book text is stored in this file.

   Input:  pages = [{ items: [{ str, x, y, font }] }]  (see normalizePage)
   Output: { generalIntro, chapters: { N: { sanskritTitle, englishTitle, intro,
             verses: { n: { range, speaker, translation, commentary, linkLine } },
             verseIndex: { n: startOfGroup }, closing } } }                        */

export const PARSER_VERSION = 1;
const RUNNING_HEADER = "holy geeta by swami chinmayananda";
const LINE_TOLERANCE = 2; // points: items this close vertically share a line
const PARAGRAPH_GAP = 22; // points: normal line spacing is ~15
const PAGE_BOTTOM = 125; // a last line below this y means the page was full
const STANDALONE = /^(?:Chapter\s+\d{1,2}|(?:Om\s*){3,})$/i;

/** Turn one page of pdf.js getTextContent() output into plain, comparable items. */
export function normalizePage(textContent) {
  return {
    items: textContent.items
      .filter((it) => typeof it.str === "string" && it.str.length)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        // pdf.js names fonts like "g_d0_f3"; the document prefix can differ, the "f3" does not.
        font: String(it.fontName || "").replace(/^.*_(f\d+)$/, "$1"),
      })),
  };
}

function pageLines(page) {
  const rows = [];
  for (const it of page.items) {
    let row = rows.find((r) => Math.abs(r.y - it.y) <= LINE_TOLERANCE);
    if (!row) rows.push((row = { y: it.y, items: [] }));
    row.items.push(it);
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      const counts = {};
      for (const it of row.items) counts[it.font] = (counts[it.font] || 0) + it.str.trim().length;
      const font = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      const text = row.items
        .map((i) => i.str)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      return { y: row.y, text, font };
    })
    .filter((l) => l.text);
}

const isHeader = (line) => line.text.toLowerCase() === RUNNING_HEADER;
const isPageNumber = (line) => /^\d{1,4}$/.test(line.text) && line.y < 90;

function joinLines(a, b) {
  if (!a) return b;
  // Line-end hyphens in this book are compound words ("Arjuna-condition"): keep them.
  return /-$/.test(a) && !/\s-$/.test(a) ? a + b : a + " " + b;
}

/** Group lines into paragraphs, rejoining paragraphs split across pages. */
function paragraphs(pages) {
  const all = pages.map(pageLines);
  // Font roles from character counts over the whole book (not from font names).
  const totals = {};
  let headerFont = "";
  for (const lines of all)
    for (const l of lines) {
      if (isHeader(l)) headerFont = l.font;
      else totals[l.font] = (totals[l.font] || 0) + l.text.length;
    }
  const ranked = Object.entries(totals)
    .filter(([f]) => f !== headerFont)
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => f);
  const bodyFont = ranked[0];
  const verseFont = ranked[1];
  const role = (font) => (font === verseFont ? "verse" : font === bodyFont ? "body" : "other");

  const out = [];
  let current = null;
  let lastY = null;
  let pageWasFull = false;
  for (const lines of all) {
    const content = lines.filter((l) => !isHeader(l) && !isPageNumber(l));
    content.forEach((line, i) => {
      const r = role(line.font);
      let start;
      if (!current) start = true;
      else if (i === 0) {
        // First line of a page: continue only if the previous page ran to the bottom
        // and this line reads as a continuation.
        const prevEnds = /[.!?:"'”’)]$/.test(current.text);
        const continues = /^[a-z(,;]/.test(line.text) || !prevEnds;
        start = !(pageWasFull && continues && r === current.role);
      } else start = lastY - line.y > PARAGRAPH_GAP || r !== current.role;
      // Headings and the "Om Om Om" line always stand alone, even at a page break.
      if (STANDALONE.test(line.text) || STANDALONE.test(current?.text || "")) start = true;
      if (start) {
        current = { text: line.text, role: r };
        out.push(current);
      } else current.text = joinLines(current.text, line.text);
      lastY = line.y;
    });
    if (content.length) pageWasFull = content[content.length - 1].y < PAGE_BOTTOM;
  }
  return out;
}

// "N." or "N-M." with an optional speaker. The book occasionally drops the period ("12 ...").
const VERSE_HEAD =
  /^(?:([A-Za-z][A-Za-z .]{0,40}?)\s*[Ss]a(?:id|ys)\s*:\s*)?(\d{1,2})\s*(?:[-–]\s*(\d{1,2}))?\s*(?:\.\s*|\s+(?=["“'A-Z(]))([\s\S]*)$/;
const CHAPTER_HEAD = /^Chapter\s+(\d{1,2})$/;
const COLOPHON = /^Thus,?\s+in\s+the\s+UPANISHADS?\b/i;
const OM_LINE = /^(Om\s*){3,}$/i;

function isLinkLine(text) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.85;
}

/** Parse normalized pages into the book structure. */
export function parseBook(pages) {
  const paras = paragraphs(pages);
  const book = { parserVersion: PARSER_VERSION, generalIntro: [], chapters: {} };
  let mode = "front"; // front | intro | chapter-title | chapter | closing
  let chapter = null;
  let verse = null;
  let lastVerse = 0;
  let titleLines = 0;

  const finishVerse = () => {
    if (!verse) return;
    const last = verse.commentary[verse.commentary.length - 1];
    if (last && isLinkLine(last)) verse.linkLine = verse.commentary.pop();
    verse = null;
  };

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const text = p.text;
    const chapterMatch = text.match(CHAPTER_HEAD);
    if (mode === "front") {
      if (/^general introduction$/i.test(text)) mode = "intro";
      continue;
    }
    if (chapterMatch && Number(chapterMatch[1]) === (chapter ? chapter.number + 1 : 1)) {
      finishVerse();
      chapter = {
        number: Number(chapterMatch[1]),
        sanskritTitle: "",
        englishTitle: "",
        intro: [],
        verses: {},
        verseIndex: {},
        closing: [],
      };
      book.chapters[chapter.number] = chapter;
      mode = "chapter-title";
      titleLines = 0;
      lastVerse = 0;
      continue;
    }
    if (mode === "intro") {
      book.generalIntro.push(text);
      continue;
    }
    if (
      mode === "chapter-title" &&
      titleLines < 4 &&
      text.split(/\s+/).length <= 12 &&
      !VERSE_HEAD.test(text)
    ) {
      // Sanskrit title first, then the English title (which can wrap onto a second piece).
      if (titleLines === 0) chapter.sanskritTitle = text;
      else chapter.englishTitle = joinLines(chapter.englishTitle, text);
      titleLines++;
      continue;
    }
    if (mode === "chapter-title") mode = "chapter";
    if (mode === "closing") {
      if (!OM_LINE.test(text)) chapter.closing.push(text);
      continue;
    }
    if (COLOPHON.test(text)) {
      finishVerse();
      mode = "closing";
      chapter.closing.push(text);
      continue;
    }
    // A verse starts in the verse font. When a verse's first line is mostly capitalised
    // names (set in the body font), the paragraph right after it is in the verse font.
    const looksLikeVerse = p.role !== "body" || paras[i + 1]?.role === "verse";
    const head = looksLikeVerse ? text.match(VERSE_HEAD) : null;
    const start = head ? Number(head[2]) : 0;
    const end = head ? Math.max(start, Number(head[3] || start)) : 0;
    const inSequence = start > lastVerse || (start === lastVerse && end > lastVerse); // 20-21 then 21-22
    if (head && inSequence && start <= lastVerse + 6) {
      finishVerse();
      verse = {
        range: [start, end],
        speaker: (head[1] || "").trim(),
        translation: head[4].trim(),
        commentary: [],
        linkLine: "",
      };
      chapter.verses[start] = verse;
      for (let n = start; n <= end; n++)
        if (!chapter.verseIndex[n] || n > lastVerse) chapter.verseIndex[n] = start;
      lastVerse = verse.range[1];
      continue;
    }
    if (verse && p.role !== "body" && !verse.commentary.length) {
      verse.translation = joinLines(verse.translation, text); // verse text broken by a gap
      continue;
    }
    if (verse) verse.commentary.push(text);
    else if (chapter) chapter.intro.push(text);
  }
  finishVerse();
  return book;
}

/** Resolve a verse number (even one inside a group like 20-21) to its entry. */
export function findVerse(book, chapterNumber, verseNumber) {
  const ch = book.chapters[chapterNumber];
  if (!ch) return null;
  const key = ch.verseIndex[verseNumber];
  return key ? ch.verses[key] : null;
}

// Exposed for the dev inspection scripts.
export { paragraphs as _paragraphs };
