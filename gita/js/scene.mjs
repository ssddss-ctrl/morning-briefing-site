/* The day's painted scene of Kurukshetra.
   The image function (worker/) adds the fixed style prefix and the rules itself, so the
   rule that Krishna's face is never shown can't be left out by the page. This module
   only sends the day's setting, a random variation, and the chapter's radiance. */
import { dbRun } from "./book-store.mjs";

const TIMES = ["at dawn", "at golden hour", "at dusk", "under moonlight"];
const VIEWS = ["wide view", "low angle", "aerial view", "closer view"];
const AIRS = ["drifting dust", "soft mist", "clear air", "wind-blown banners"];

// The light grows warmer and more radiant through the book, peaking in Chapter 11.
const RADIANCE = {
  1: "only the faintest warm glow on the horizon",
  2: "a soft golden light beginning to gather around the chariot",
  3: "warm morning light, a gentle golden radiance around Krishna's figure",
  6: "clear radiant light, a golden glow growing around the chariot",
  9: "intense luminous radiance around Krishna, the sky alive with golden light",
  11: "overwhelming cosmic radiance as of a thousand suns, light filling the whole sky",
  12: "deep serene golden radiance resting over the whole field",
  16: "steady vast radiance, warm and luminous",
  18: "a vast sunrise of golden radiance at the center of the world",
};

export function radianceFor(chapter) {
  const key = Object.keys(RADIANCE)
    .map(Number)
    .filter((k) => k <= chapter)
    .pop();
  return RADIANCE[key];
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function promptParts(day) {
  return {
    scene: day.scene,
    variation: `${pick(TIMES)}, ${pick(VIEWS)}, ${pick(AIRS)}`,
    radiance: radianceFor(day.chapter),
  };
}

/** Ask the image function for a new painting. Returns a Blob or throws. */
export async function generate(day, { endpoint, passphrase }) {
  if (!endpoint || !passphrase) throw new Error("Scenes are not set up yet (Settings → Scenes).");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Passphrase": passphrase },
      body: JSON.stringify(promptParts(day)),
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error("The scene passphrase was not accepted.");
    if (!response.ok) throw new Error(`The painting could not be made (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/"))
      throw new Error("The painting service sent something unexpected.");
    await dbRun("scenes", "readwrite", (s) =>
      s.put({ blob, date: new Date().toISOString() }, day.day),
    );
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

export const savedScene = async (dayNumber) =>
  (await dbRun("scenes", "readonly", (s) => s.get(dayNumber)))?.blob || null;

export async function keep(day, blob) {
  await dbRun("gallery", "readwrite", (s) =>
    s.add({
      blob,
      day: day.day,
      ref: day.ref,
      chapter: day.chapter,
      date: new Date().toISOString(),
    }),
  );
}

export const gallery = () => dbRun("gallery", "readonly", (s) => s.getAll());
export const removeFromGallery = (id) => dbRun("gallery", "readwrite", (s) => s.delete(id));

/** A kept painting to show when a new one can't be made (offline or failed). */
export async function fallbackImage() {
  const kept = await gallery();
  return kept.length ? kept[Math.floor(Math.random() * kept.length)].blob : null;
}

/** Layers for the scene frame: image (or gradient), drifting dust and slow light shafts. */
export function frameHTML(chapter) {
  const motes = Array.from({ length: 14 }, (_, i) => {
    const x = (i * 37) % 100;
    const delay = (i * 1.7) % 9;
    const size = 2 + (i % 3);
    return `<span class="mote" style="left:${x}%;animation-delay:-${delay}s;width:${size}px;height:${size}px"></span>`;
  }).join("");
  return `<div class="scene-frame" data-chapter="${chapter}">
    <div class="scene-gradient"></div>
    <img class="scene-img" alt="" hidden>
    ${chapter === 11 ? '<canvas class="cosmic" aria-hidden="true"></canvas>' : ""}
    <div class="shafts" aria-hidden="true"></div>
    <div class="motes" aria-hidden="true">${motes}</div>
  </div>`;
}

export function showImage(frame, blob) {
  const img = frame.querySelector(".scene-img");
  if (!img || !blob) return;
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  const url = URL.createObjectURL(blob);
  img.dataset.url = url;
  img.onload = () => {
    img.hidden = false;
    img.classList.add("shown");
  };
  img.src = url;
}

/** Chapter 11: a code-drawn field of radiant suns, gently breathing. */
export function startCosmic(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const suns = Array.from({ length: 90 }, () => ({
    a: Math.random() * Math.PI * 2,
    r: Math.random(),
    s: 0.4 + Math.random() * 1.6,
    p: Math.random() * 6,
  }));
  let frame = 0;
  let raf = 0;
  const draw = () => {
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    const cx = w / 2;
    const cy = h * 0.42;
    ctx.clearRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
    glow.addColorStop(0, "rgba(255, 236, 190, 0.85)");
    glow.addColorStop(0.25, "rgba(244, 180, 80, 0.45)");
    glow.addColorStop(1, "rgba(18, 22, 51, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    for (const sun of suns) {
      const pulse = reduce ? 1 : 0.6 + 0.4 * Math.sin(frame / 40 + sun.p);
      const dist = (0.15 + sun.r * 0.85) * Math.max(w, h) * 0.55;
      const x = cx + Math.cos(sun.a) * dist;
      const y = cy + Math.sin(sun.a) * dist * 0.75;
      const rad = sun.s * devicePixelRatio * 3 * pulse;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 4);
      g.addColorStop(0, "rgba(255, 248, 225, 0.95)");
      g.addColorStop(1, "rgba(255, 200, 110, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    frame++;
    if (!reduce) raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}
