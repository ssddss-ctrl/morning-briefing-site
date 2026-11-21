/* English read-aloud with the browser's free Web Speech voices.
   Sanskrit is never spoken by a synthetic voice (see CLAUDE.md). */

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
let queue = [];
let onEnd = null;

export const supported = () => Boolean(synth);

export function englishVoices() {
  return synth ? synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang)) : [];
}

export function stop() {
  queue = [];
  if (synth) synth.cancel();
  const done = onEnd;
  onEnd = null;
  if (done) done();
}

/** Read the paragraphs one after another. Calls `ended` when finished or stopped. */
export function speak(paragraphs, { voiceName = "", rate = 1 } = {}, ended = () => {}) {
  stop();
  if (!synth) return ended();
  queue = paragraphs.filter(Boolean).map((t) => t.replace(/\s+/g, " ").trim());
  onEnd = ended;
  const voice = englishVoices().find((v) => v.name === voiceName);
  const next = () => {
    const text = queue.shift();
    if (!text) {
      const done = onEnd;
      onEnd = null;
      if (done) done();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "en-IN";
    u.rate = rate;
    u.onend = next;
    u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? null : next());
    synth.speak(u);
  };
  next();
}

export const speaking = () => Boolean(onEnd);
