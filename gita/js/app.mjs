/* The Gita room: home, the daily session, recap, starred verses, gallery and settings.
   Book text comes only from the owner's own PDF, parsed on this device (book-store.mjs). */
import {
  loadBook,
  importPdf,
  resolve,
  integrity,
  fullCommentary,
  translation,
  kvSet,
} from "./book-store.mjs";
import * as P from "./progress.mjs";
import * as Speech from "./speech.mjs";
import * as Scene from "./scene.mjs";

const root = document.getElementById("gita");
const DEV = new URLSearchParams(location.search).has("dev");
const KEYS = { progress: "gita:progress", settings: "gita:settings", summary: "gita:summary" };
const ASSET_VERSION = "gita-assets-1";

// ---------- Small helpers ----------
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x],
  );
const paras = (list) => list.map((t) => `<p>${esc(t)}</p>`).join("");
const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

let content = null;
let sanskrit = {};
let book = null;
let progress = Object.assign(P.emptyProgress(), store.get(KEYS.progress, {}));
let settings = Object.assign(
  { voice: "", rate: 0.95, recap: true, endpoint: "", passphrase: "" },
  store.get(KEYS.settings, {}),
);
let cleanup = [];

const today = () => P.isoDate();
const dayAt = (n) => content.days[n - 1];
const saveProgress = () => {
  store.set(KEYS.progress, progress);
  store.set(KEYS.summary, P.summary(progress, content.days));
};
const saveSettings = () => store.set(KEYS.settings, settings);

function listenButton(id, label = "Listen") {
  return `<button class="listen" data-listen="${id}" aria-pressed="false"><span class="listen-dot" aria-hidden="true"></span>${label}</button>`;
}
const listenTexts = new Map();
function wireListen() {
  root.querySelectorAll("[data-listen]").forEach((b) => {
    b.onclick = () => {
      const on = b.getAttribute("aria-pressed") === "true";
      Speech.stop();
      root
        .querySelectorAll("[data-listen]")
        .forEach((x) => x.setAttribute("aria-pressed", "false"));
      if (on) return;
      b.setAttribute("aria-pressed", "true");
      Speech.speak(
        listenTexts.get(b.dataset.listen) || [],
        { voiceName: settings.voice, rate: settings.rate },
        () => b.setAttribute("aria-pressed", "false"),
      );
    };
  });
}

function header(title, back = "#/") {
  return `<header class="g-top"><a class="g-back" href="${back}">${back === "../" ? "← Briefing" : "← Back"}</a><span class="g-title">${esc(title)}</span><a class="g-icon" href="#/settings" aria-label="Settings">Settings</a></header>`;
}

// ---------- Chapter map ----------
function chapterMap(highlight = null) {
  const stages = [
    ["The path of action", 1, 6],
    ["The path of devotion", 7, 12],
    ["The path of knowledge", 13, 18],
  ];
  const titles = book
    ? Object.fromEntries(Object.entries(book.chapters).map(([n, ch]) => [n, ch.sanskritTitle]))
    : {};
  return `<div class="map">${stages
    .map(
      ([name, a, b]) =>
        `<section class="stage"><h3>${name}</h3>${Array.from({ length: b - a + 1 }, (_, i) => a + i)
          .map((c) => {
            const days = content.days.filter((d) => d.chapter === c);
            return `<div class="map-row"><span class="map-ch">${c}</span><span class="map-name">${esc(titles[c] || `Chapter ${c}`)}</span><span class="map-dots">${days
              .map((d) => {
                const done = Boolean(progress.completed[d.day]);
                const now = d.day === highlight || (!done && d.day === progress.nextDay);
                const cls = `dot${done ? " lit" : ""}${now ? " now" : ""}`;
                return done
                  ? `<a class="${cls}" href="#/day/${d.day}" aria-label="Day ${d.day}, ${d.ref}, studied"></a>`
                  : `<span class="${cls}" aria-label="Day ${d.day}, ${d.ref}"></span>`;
              })
              .join("")}</span></div>`;
          })
          .join("")}</section>`,
    )
    .join("")}</div>`;
}

// ---------- Home ----------
function renderHome() {
  if (!book) return renderOnboarding();
  const plan = P.todayPlan(progress, content.days.length, today());
  const streak = P.currentStreak(progress, today());
  const due = P.dueReviews(progress, today(), plan.kind === "new" ? plan.day : null).length;
  const recap = settings.recap ? P.recapDays(progress, today()) : [];
  const day = plan.day ? dayAt(plan.day) : null;
  const ch = day ? book.chapters[day.chapter] : null;
  root.innerHTML = `${header("Bhagavad Gita", "../")}
  <section class="g-hero">
    <p class="g-eyebrow">${plan.kind === "done" ? "Today's verse is complete" : plan.kind === "finished" ? "All 100 days studied" : `Day ${plan.day} of ${content.days.length}`}</p>
    <h1>${day ? `<span class="g-ref">${esc(day.ref)}</span><em>${esc(ch?.sanskritTitle || "")}</em>` : "Hari Om"}</h1>
    <p class="g-meta">${streak ? `${streak}-day streak` : "A new streak begins today"}${due ? ` · ${due} verse${due === 1 ? "" : "s"} to recall` : ""}</p>
    ${
      plan.kind === "new"
        ? `<a class="g-begin" href="#/session">Begin today's practice</a>`
        : plan.kind === "done"
          ? `<a class="g-begin quiet" href="#/day/${plan.day}">Read today's verse again</a>`
          : `<a class="g-begin quiet" href="#/verses">Go to my verses</a>`
    }
  </section>
  ${recap.length ? `<a class="g-card" href="#/recap"><span class="g-eyebrow">Weekend recap</span><span>The last ${recap.length} verses as one thread</span></a>` : ""}
  <nav class="g-links"><a href="#/verses">My verses</a><a href="#/gallery">Gallery</a><a href="#/settings">Settings</a></nav>
  <h2 class="g-section">The eighteen chapters</h2>
  ${chapterMap()}
  ${DEV ? devPanel() : ""}`;
  wireDev();
}

function renderOnboarding(message = "") {
  root.innerHTML = `${header("Bhagavad Gita", "../")}
  <section class="g-hero">
    <p class="g-eyebrow">Before the first day</p>
    <h1>Choose your copy of the <em>Holy Geeta</em></h1>
    <p class="g-lead">The translation and commentary are read from your own PDF of Swami Chinmayananda's <em>Holy Geeta</em>, here on this phone. The book never leaves this device and is never uploaded.</p>
    <label class="g-begin file">Choose the PDF<input type="file" id="pdf" accept="application/pdf,.pdf" hidden></label>
    <p class="g-status" id="status" role="status">${esc(message)}</p>
  </section>`;
  const input = root.querySelector("#pdf");
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const status = root.querySelector("#status");
    try {
      status.textContent = "Opening the book…";
      book = await importPdf(
        file,
        (n, total) => (status.textContent = `Reading page ${n} of ${total}…`),
      );
      const check = integrity(book, content.days);
      status.textContent = `Ready. ${check.exact} of ${check.total} passages found exactly.`;
      // Let the confirmation be read, then open the home screen.
      setTimeout(() => {
        if (!root.querySelector("#pdf")) return; // Already moved on.
        location.hash === "#/" || !location.hash ? route() : (location.hash = "#/");
      }, 1500);
    } catch (e) {
      status.textContent = e.message || "The PDF could not be read.";
    }
  };
}

// ---------- The session ----------
function sanskritBlock(ref, { lines = true } = {}) {
  const s = sanskrit[ref];
  if (!s) return "";
  return `<div class="sa" lang="sa">
    ${s.speaker ? `<p class="sa-speaker">${esc(s.speaker)} <span lang="sa-Latn">${esc(s.speakerIAST)}</span></p>` : ""}
    <div class="sa-deva">${s.devanagari.map((l) => `<span>${esc(l)}</span>`).join("")}</div>
    ${lines ? `<div class="sa-iast" lang="sa-Latn">${s.iast.map((l) => `<span>${esc(l)}</span>`).join("")}</div>` : ""}
  </div>`;
}

function chantButton(ref) {
  const audio = sanskrit[ref]?.audio;
  return audio
    ? `<button class="chant" data-chant="${esc(audio)}">Play the chant</button>`
    : `<button class="chant" disabled>Chanting · coming soon</button>`;
}

function translationsFor(day) {
  // Grouped verses (like 20-21) share one translation in the book.
  const seen = new Set();
  return day.verses
    .map((v) => {
      const key = book.chapters[day.chapter].verseIndex[v];
      if (seen.has(key)) return "";
      seen.add(key);
      return translation(book, day.chapter, v);
    })
    .filter(Boolean);
}

function buildSteps(day, preview) {
  const steps = ["scene"];
  if (!preview && P.dueReviews(progress, today(), day.day).length) steps.push("recall");
  if (content.chapters[day.chapter].firstDay === day.day && day.intro) steps.push("intro");
  steps.push("thread", "verse", "words", "close");
  return steps;
}

const STEP_LABEL = {
  scene: "Kurukshetra",
  recall: "Recall",
  intro: "The chapter",
  thread: "The thread",
  verse: "The verse",
  words: "In his words",
  close: "Close",
};

async function renderSession(dayNumber, preview = false) {
  if (!book) return renderOnboarding("Choose the PDF first, then begin.");
  const day = dayAt(dayNumber);
  if (!day) return (location.hash = "#/");
  const steps = buildSteps(day, preview);
  const due = preview ? [] : P.dueReviews(progress, today(), day.day);
  let index = 0;
  let sceneBlob = null;
  let stopCosmic = () => {};

  root.innerHTML = `${header(preview ? `Day ${day.day} · ${day.ref}` : `Day ${day.day}`)}
    <div class="steps" role="progressbar" aria-valuemin="1" aria-valuemax="${steps.length}">${steps.map((s) => `<span data-step="${s}"></span>`).join("")}</div>
    <article class="step" id="step" aria-live="polite"></article>
    <footer class="step-nav"><button class="nav-back" id="back">Back</button><button class="nav-next" id="next">Continue</button></footer>`;
  const stepEl = root.querySelector("#step");

  // Scene: show a saved painting, or start painting now so it is ready by the close.
  const painting = (async () => {
    sceneBlob = await Scene.savedScene(day.day);
    if (sceneBlob || preview || !settings.endpoint) return sceneBlob;
    try {
      sceneBlob = await Scene.generate(day, settings);
    } catch (e) {
      setSceneStatus(e.message);
    }
    return sceneBlob;
  })();
  function setSceneStatus(text) {
    const s = root.querySelector("#scene-status");
    if (s) s.textContent = text;
  }
  async function fillFrame(frame) {
    if (!frame) return;
    stopCosmic();
    stopCosmic = Scene.startCosmic(frame.querySelector(".cosmic"));
    const blob = sceneBlob || (await painting) || (await Scene.fallbackImage());
    if (blob) Scene.showImage(frame, blob);
  }

  const show = async () => {
    Speech.stop();
    listenTexts.clear();
    const step = steps[index];
    root
      .querySelectorAll("[data-step]")
      .forEach((el, i) => el.classList.toggle("done", i <= index));
    root.querySelector("#back").disabled = index === 0;
    root.querySelector("#next").textContent = step === "close" ? "Finish" : "Continue";
    stepEl.dataset.step = step;
    stepEl.innerHTML = `<p class="step-label">${STEP_LABEL[step]}</p>` + (await stepHTML(step));
    wireStep(step);
    wireListen();
    stepEl.scrollIntoView({ block: "start" });
  };

  async function stepHTML(step) {
    const ref = `${day.chapter}.${day.verses[0]}`;
    if (step === "scene")
      return `${Scene.frameHTML(day.chapter)}
        <div class="scene-actions"><button id="keep">Keep</button><button id="regen">Paint another</button></div>
        <p class="g-status" id="scene-status" role="status">${settings.endpoint ? "" : "Paintings appear once scenes are set up in Settings."}</p>`;
    if (step === "recall") return `<div id="recall"></div>`;
    if (step === "intro") {
      const ch = book.chapters[day.chapter];
      const text = resolve(book, day.intro);
      listenTexts.set("intro", [
        `Chapter ${day.chapter}. ${ch.sanskritTitle}. ${ch.englishTitle}.`,
        ...text,
      ]);
      return `<h2 class="ch-title"><span>Chapter ${day.chapter}</span>${esc(ch.sanskritTitle)}<em>${esc(ch.englishTitle)}</em></h2>
        ${listenButton("intro")}<div class="prose">${paras(text)}</div>`;
    }
    if (step === "thread") {
      const parts = day.thread.map((t) =>
        t.by === "mine"
          ? {
              text: [t.text],
              html: `<div class="thread mine"><span class="by">A bridge, not from the book</span><p>${esc(t.text)}</p></div>`,
            }
          : (() => {
              const text = resolve(book, t);
              return {
                text,
                html: `<div class="thread his${t.part === "link" ? " link" : ""}">${paras(text)}</div>`,
              };
            })(),
      );
      listenTexts.set(
        "thread",
        parts.flatMap((p) => p.text),
      );
      return `${listenButton("thread")}${parts.map((p) => p.html).join("")}`;
    }
    if (step === "verse") {
      const english = translationsFor(day);
      listenTexts.set("verse", english);
      return `${day.verses.map((v) => sanskritBlock(`${day.chapter}.${v}`)).join("")}
        <div class="verse-actions">${chantButton(ref)}${listenButton("verse", "Listen in English")}</div>
        <div class="translation fade-in">${english.map((t) => `<p>${esc(t)}</p>`).join("")}<p class="tr-ref">${esc(day.ref)}</p></div>`;
    }
    if (step === "words") {
      const text = day.words.flatMap((w) => resolve(book, w));
      listenTexts.set("words", text);
      const full = fullCommentary(book, day);
      listenTexts.set("full", full);
      return `${listenButton("words")}<div class="prose">${paras(text)}</div>
        <details class="full"><summary>Read his full commentary</summary>${listenButton("full", "Listen to all")}<div class="prose">${paras(full)}</div></details>`;
    }
    // close
    const english = translationsFor(day);
    const extra = day.close ? resolve(book, day.close) : [];
    if (!preview && !progress.completed[day.day]) {
      P.completeDay(progress, day.day, today());
      saveProgress();
    }
    const starred = progress.starred.includes(day.day);
    const streak = P.currentStreak(progress, today());
    return `${Scene.frameHTML(day.chapter).replace("scene-frame", "scene-frame small")}
      ${sanskritBlock(ref, { lines: false })}
      <div class="translation">${english.map((t) => `<p>${esc(t)}</p>`).join("")}</div>
      ${extra.length ? `<div class="translation extra">${extra.map((t) => `<p>${esc(t)}</p>`).join("")}<p class="tr-ref">${day.close.c}.${day.close.v}</p></div>` : ""}
      <div class="close-row"><button class="star${starred ? " on" : ""}" id="star" aria-pressed="${starred}">${starred ? "★ Starred" : "☆ Star this verse"}</button>
      <span class="streak">${streak ? `${streak}-day streak` : ""}</span></div>
      ${chapterMap(day.day)}`;
  }

  function wireStep(step) {
    if (step === "scene" || step === "close") fillFrame(stepEl.querySelector(".scene-frame"));
    if (step === "scene") {
      stepEl.querySelector("#keep").onclick = async () => {
        const blob = sceneBlob || (await painting);
        if (!blob) return setSceneStatus("There's no painting to keep yet.");
        await Scene.keep(day, blob);
        setSceneStatus("Kept in your gallery.");
      };
      stepEl.querySelector("#regen").onclick = async () => {
        setSceneStatus("Painting a new scene…");
        try {
          sceneBlob = await Scene.generate(day, settings);
          Scene.showImage(stepEl.querySelector(".scene-frame"), sceneBlob);
          setSceneStatus("");
        } catch (e) {
          setSceneStatus(e.message);
        }
      };
      if (settings.endpoint && !sceneBlob) {
        setSceneStatus("Painting today's scene…");
        painting.then((b) => {
          if (b) {
            Scene.showImage(stepEl.querySelector(".scene-frame"), b);
            setSceneStatus("");
          }
        });
      }
    }
    if (step === "recall") renderRecall(stepEl.querySelector("#recall"), due);
    if (step === "close") {
      const star = stepEl.querySelector("#star");
      star.onclick = () => {
        P.toggleStar(progress, day.day);
        saveProgress();
        const on = progress.starred.includes(day.day);
        star.classList.toggle("on", on);
        star.setAttribute("aria-pressed", on);
        star.textContent = on ? "★ Starred" : "☆ Star this verse";
      };
    }
    stepEl
      .querySelectorAll("[data-chant]")
      .forEach((b) => (b.onclick = () => new Audio(b.dataset.chant).play()));
  }

  root.querySelector("#next").onclick = () => {
    if (index < steps.length - 1) {
      index++;
      show();
    } else location.hash = "#/";
  };
  root.querySelector("#back").onclick = () => {
    if (index > 0) {
      index--;
      show();
    }
  };
  cleanup.push(() => stopCosmic());
  show();
}

function renderRecall(el, due) {
  let i = 0;
  const card = () => {
    if (i >= due.length) {
      el.innerHTML = `<p class="g-lead">All recalled. Continue to today's verse.</p>`;
      return;
    }
    const d = dayAt(due[i].day);
    const s = sanskrit[`${d.chapter}.${d.verses[0]}`];
    el.innerHTML = `<button class="recall-card" id="flip" aria-expanded="false">
        <span class="recall-ref">${esc(d.ref)}</span>
        <span class="sa-deva" lang="sa">${esc(s?.devanagari[0] || "")}</span>
        <span class="recall-hint">Tap to see his translation</span>
        <span class="recall-back" hidden>${translationsFor(d)
          .map((t) => `<span>${esc(t)}</span>`)
          .join("")}</span>
      </button>
      <div class="grades" hidden><button data-grade="remembered">Remembered</button><button data-grade="fuzzy">Fuzzy</button><button data-grade="forgot">Forgot</button></div>
      <p class="recall-count">${i + 1} of ${due.length}</p>`;
    el.querySelector("#flip").onclick = (e) => {
      e.currentTarget.setAttribute("aria-expanded", "true");
      el.querySelector(".recall-back").hidden = false;
      el.querySelector(".recall-hint").hidden = true;
      el.querySelector(".grades").hidden = false;
    };
    el.querySelectorAll("[data-grade]").forEach(
      (b) =>
        (b.onclick = () => {
          P.gradeReview(progress, d.day, b.dataset.grade, today());
          saveProgress();
          i++;
          card();
        }),
    );
  };
  card();
}

// ---------- Weekend recap ----------
function renderRecap() {
  if (!book) return renderOnboarding();
  const days = P.recapDays(progress, today()).map(dayAt);
  const blocks = days.map((d) => {
    const thread = d.thread.flatMap((t) => (t.by === "mine" ? [t.text] : resolve(book, t)));
    const english = translationsFor(d);
    return {
      text: [...thread, ...english],
      html: `<section class="recap-day"><p class="g-eyebrow">${esc(d.ref)}</p>${d.thread.map((t) => (t.by === "mine" ? `<p class="mine-inline">${esc(t.text)}</p>` : paras(resolve(book, t)))).join("")}<blockquote>${english.map(esc).join(" ")}</blockquote></section>`,
    };
  });
  listenTexts.clear();
  listenTexts.set(
    "recap",
    blocks.flatMap((b) => b.text),
  );
  root.innerHTML = `${header("Weekend recap")}<p class="g-lead">The last ${days.length} verses, told as one thread. Bridges marked in italics are not from the book.</p>${listenButton("recap")}${blocks.map((b) => b.html).join("") || "<p class='g-lead'>Study a few days first.</p>"}`;
  wireListen();
}

// ---------- My verses and memorize mode ----------
function renderVerses() {
  if (!book) return renderOnboarding();
  const days = progress.starred.map(dayAt).filter(Boolean);
  root.innerHTML = `${header("My verses")}${
    days.length
      ? days
          .map(
            (d) =>
              `<section class="my-verse"><p class="g-eyebrow">${esc(d.ref)}</p>${sanskritBlock(`${d.chapter}.${d.verses[0]}`, { lines: false })}<p>${esc(translationsFor(d).join(" "))}</p><a class="g-link" href="#/memorize/${d.day}">Memorize</a></section>`,
          )
          .join("")
      : `<p class="g-lead">Star a verse at the end of a session to keep it here.</p>`
  }`;
}

function renderMemorize(dayNumber) {
  const d = dayAt(dayNumber);
  const s = sanskrit[`${d.chapter}.${d.verses[0]}`];
  if (!s) return (location.hash = "#/verses");
  const words = s.devanagari.flatMap((line, li) =>
    line.split(/\s+/).map((w, wi) => ({ w, li, id: `${li}-${wi}` })),
  );
  // A fixed, shuffled order so words disappear a little at a time.
  const order = words.map((x, i) => i).sort((a, b) => ((a * 7919) % 97) - ((b * 7919) % 97));
  let hidden = 0;
  const draw = () => {
    const hide = new Set(order.slice(0, hidden));
    root.querySelector("#mem").innerHTML = s.devanagari
      .map(
        (line, li) =>
          `<span>${words.map((x, i) => (x.li === li ? `<b class="${hide.has(i) ? "gone" : ""}">${esc(x.w)}</b>` : "")).join(" ")}</span>`,
      )
      .join("");
  };
  root.innerHTML = `${header(`Memorize ${d.ref}`, "#/verses")}
    <p class="g-lead">Read the verse aloud to yourself. Each tap on "Hide more" hides a few more words.</p>
    <div class="sa-deva memorize" id="mem" lang="sa"></div>
    <div class="verse-actions">${chantButton(`${d.chapter}.${d.verses[0]}`).replace("Play the chant", "Loop the chant")}<button id="more">Hide more</button><button id="all">Show all</button></div>
    <div class="sa-iast" lang="sa-Latn">${s.iast.map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
  root.querySelector("#more").onclick = () => {
    hidden = Math.min(words.length, hidden + Math.max(1, Math.ceil(words.length / 6)));
    draw();
  };
  root.querySelector("#all").onclick = () => {
    hidden = 0;
    draw();
  };
  root.querySelectorAll("[data-chant]").forEach((b) => {
    b.onclick = () => {
      const a = new Audio(b.dataset.chant);
      a.loop = true;
      a.play();
      cleanup.push(() => a.pause());
    };
  });
  draw();
}

// ---------- Gallery ----------
async function renderGallery() {
  root.innerHTML = `${header("Gallery")}<div class="gallery" id="gal"><p class="g-lead">Loading…</p></div>`;
  const items = (await Scene.gallery()).reverse();
  const urls = [];
  root.querySelector("#gal").innerHTML = items.length
    ? items
        .map((it) => {
          const url = URL.createObjectURL(it.blob);
          urls.push(url);
          return `<figure><img src="${url}" alt="Kurukshetra, day ${it.day}" loading="lazy"><figcaption>${esc(it.ref)} <button data-remove="${it.id}">Remove</button></figcaption></figure>`;
        })
        .join("")
    : `<p class="g-lead">Paintings you keep appear here.</p>`;
  root.querySelectorAll("[data-remove]").forEach(
    (b) =>
      (b.onclick = async () => {
        await Scene.removeFromGallery(Number(b.dataset.remove));
        renderGallery();
      }),
  );
  cleanup.push(() => urls.forEach((u) => URL.revokeObjectURL(u)));
}

// ---------- Settings ----------
function renderSettings() {
  const check = book ? integrity(book, content.days) : null;
  const voices = Speech.englishVoices();
  root.innerHTML = `${header("Settings")}
  <section class="set"><h2>The book</h2>
    <p>${book ? `Loaded ${esc(new Date(book.importedAt).toLocaleDateString())}. ${check.exact} of ${check.total} passages found exactly.` : "No PDF loaded yet."}</p>
    <label class="g-btn file">${book ? "Reload the PDF" : "Choose the PDF"}<input type="file" id="pdf" accept="application/pdf,.pdf" hidden></label>
    <p class="g-status" id="pdf-status" role="status"></p></section>
  <section class="set"><h2>Read-aloud</h2>
    <label>Voice <select id="voice"><option value="">Default English voice</option>${voices.map((v) => `<option ${v.name === settings.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
    <label>Speed <input type="range" id="rate" min="0.7" max="1.3" step="0.05" value="${settings.rate}"> <span id="rate-val">${settings.rate}×</span></label>
    <button class="g-btn" id="test-voice">Try the voice</button></section>
  <section class="set"><h2>Weekend recap</h2>
    <label class="row"><input type="checkbox" id="recap" ${settings.recap ? "checked" : ""}> Offer a recap of the week's verses on Saturdays and Sundays</label></section>
  <section class="set"><h2>Scenes</h2>
    <p>Paintings come from your own free Cloudflare image function. Enter its address and passphrase once.</p>
    <label>Address <input id="endpoint" type="url" inputmode="url" placeholder="https://gita-scenes.….workers.dev" value="${esc(settings.endpoint)}"></label>
    <label>Passphrase <input id="pass" type="password" autocomplete="off" value="${esc(settings.passphrase)}"></label>
    <button class="g-btn" id="save-scenes">Save</button> <span class="g-status" id="scene-saved" role="status"></span></section>
  <section class="set"><h2>Progress</h2>
    <p>${Object.keys(progress.completed).length} of ${content.days.length} days studied · ${progress.starred.length} starred</p>
    <button class="g-btn" id="export">Export progress</button>
    <label class="g-btn file">Import progress<input type="file" id="import" accept="application/json,.json" hidden></label>
    <button class="g-btn danger" id="reset">Reset progress</button>
    <div id="confirm" hidden><p>This clears your streak, reviews and stars. Your book and gallery stay.</p><button class="g-btn danger" id="reset-yes">Yes, reset</button> <button class="g-btn" id="reset-no">Cancel</button></div>
    <p class="g-status" id="prog-status" role="status"></p></section>
  <section class="set"><h2>About</h2><p>Translation and commentary: Swami Chinmayananda, <em>Holy Geeta</em>, read from your own copy on this device. Sanskrit: IIT Kanpur Gita Supersite. Bridges marked "not from the book" are short notes written for this app.</p></section>
  ${DEV ? devPanel() : ""}`;
  const $ = (s) => root.querySelector(s);
  $("#pdf").onchange = async () => {
    const file = $("#pdf").files[0];
    if (!file) return;
    try {
      book = await importPdf(
        file,
        (n, t) => ($("#pdf-status").textContent = `Reading page ${n} of ${t}…`),
      );
      renderSettings();
    } catch (e) {
      $("#pdf-status").textContent = e.message;
    }
  };
  $("#voice").onchange = (e) => ((settings.voice = e.target.value), saveSettings());
  $("#rate").oninput = (e) => {
    settings.rate = Number(e.target.value);
    $("#rate-val").textContent = settings.rate + "×";
    saveSettings();
  };
  $("#test-voice").onclick = () =>
    Speech.speak(["Hari Om. This is how the commentary will sound."], {
      voiceName: settings.voice,
      rate: settings.rate,
    });
  $("#recap").onchange = (e) => ((settings.recap = e.target.checked), saveSettings());
  $("#save-scenes").onclick = () => {
    settings.endpoint = $("#endpoint").value.trim();
    settings.passphrase = $("#pass").value;
    saveSettings();
    $("#scene-saved").textContent = "Saved.";
  };
  $("#export").onclick = () => {
    const blob = new Blob(
      [JSON.stringify({ app: "gita", exportedAt: new Date().toISOString(), progress }, null, 1)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gita-progress-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#import").onchange = async () => {
    try {
      const data = JSON.parse(await $("#import").files[0].text());
      if (data.app !== "gita" || !data.progress?.completed) throw new Error();
      progress = Object.assign(P.emptyProgress(), data.progress);
      saveProgress();
      $("#prog-status").textContent = "Progress imported.";
    } catch {
      $("#prog-status").textContent = "That file isn't a Gita progress export.";
    }
  };
  $("#reset").onclick = () => ($("#confirm").hidden = false);
  $("#reset-no").onclick = () => ($("#confirm").hidden = true);
  $("#reset-yes").onclick = () => {
    progress = P.emptyProgress();
    saveProgress();
    renderSettings();
  };
  wireDev();
}

// ---------- Dev: jump to any day (hidden; add ?dev=1 to the address) ----------
function devPanel() {
  return `<section class="set dev"><h2>Developer</h2><label>Jump to day <select id="jump">${content.days.map((d) => `<option value="${d.day}">${d.day} · ${esc(d.ref)}</option>`).join("")}</select></label> <button class="g-btn" id="jump-go">Open (preview)</button></section>`;
}
function wireDev() {
  const go = root.querySelector("#jump-go");
  if (go) go.onclick = () => (location.hash = `#/day/${root.querySelector("#jump").value}`);
}

// ---------- Routing ----------
function route() {
  cleanup.forEach((f) => f());
  cleanup = [];
  Speech.stop();
  const [, view, arg] = (location.hash || "#/").split("/");
  if (view === "session") {
    const plan = P.todayPlan(progress, content.days.length, today());
    return plan.kind === "new" ? renderSession(plan.day) : renderHome();
  }
  if (view === "day") return renderSession(Number(arg), true);
  if (view === "recap") return renderRecap();
  if (view === "verses") return renderVerses();
  if (view === "memorize") return renderMemorize(Number(arg));
  if (view === "gallery") return renderGallery();
  if (view === "settings") return renderSettings();
  renderHome();
}

// Fetch every app file once so the site's offline copy has them (scenes excepted).
function warmOfflineCopy() {
  if (localStorage.getItem("gita:assets") === ASSET_VERSION || !navigator.serviceWorker?.controller)
    return;
  const files = [
    "./",
    "css/gita.css",
    "css/fonts.css",
    "js/app.mjs",
    "js/book-store.mjs",
    "js/book-parser.mjs",
    "js/progress.mjs",
    "js/speech.mjs",
    "js/scene.mjs",
    "content/days.json",
    "content/sanskrit.json",
    "vendor/pdfjs/pdf.min.mjs",
    "vendor/pdfjs/pdf.worker.min.mjs",
    "fonts/EBGaramond-normal-latin.woff2",
    "fonts/EBGaramond-italic-latin.woff2",
    "fonts/EBGaramond-normal-latin-ext.woff2",
    "fonts/EBGaramond-italic-latin-ext.woff2",
    "fonts/NotoSerifDevanagari-normal-devanagari.woff2",
    "fonts/NotoSerifDevanagari-normal-latin.woff2",
  ];
  Promise.all(files.map((f) => fetch(f).catch(() => null))).then(() =>
    localStorage.setItem("gita:assets", ASSET_VERSION),
  );
}

async function start() {
  root.innerHTML = `<p class="g-lead loading">Hari Om…</p>`;
  const [days, sa] = await Promise.all([
    fetch("content/days.json").then((r) => r.json()),
    fetch("content/sanskrit.json").then((r) => r.json()),
  ]);
  content = days;
  sanskrit = sa.verses;
  book = await loadBook().catch(() => null);
  saveProgress();
  window.addEventListener("hashchange", route);
  if ("speechSynthesis" in window)
    speechSynthesis.onvoiceschanged = () => location.hash === "#/settings" && renderSettings();
  route();
  warmOfflineCopy();
}

start().catch((e) => {
  root.innerHTML = `<p class="g-lead">The Gita room couldn't open (${esc(e.message)}). Check your connection and try again.</p>`;
});

// Exposed for the self-test only.
window.__gita = {
  get progress() {
    return progress;
  },
  kvSet,
};
