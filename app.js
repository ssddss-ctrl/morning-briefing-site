const app = document.querySelector("#app");
const CATS = ["All", "Science", "AI", "Global Affairs", "U.S. News", "Saved"];
const KEY = "morning-brief:saved",
  CITYKEY = "morning-brief:weather-city";
let active = "All",
  data = { generated_at: null, items: [] },
  voice = { on: false, index: 0, paused: false, ids: [] },
  weather = null,
  weatherBusy = false,
  weatherError = "",
  weatherCity = localStorage.getItem(CITYKEY) || "Ann Arbor, Michigan",
  weatherEditing = false,
  observer = null,
  recap = null,
  away = null,
  seenToday = new Set(),
  view = (() => {
    try {
      return localStorage.getItem("morning-brief:view") === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  })(),
  expanded = new Set();
const missedState = MissedBriefings.load(localStorage);
let saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
})();
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x],
  );
const dateText = (s, dateOnly = false) => {
  let d = new Date(dateOnly && s ? s.slice(0, 10) + "T12:00:00" : s);
  return !s || isNaN(d)
    ? "Date unavailable"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
function visible() {
  return data.items.filter(
    (x) =>
      (active === "All" && x.daily !== false) ||
      (active === "Saved" ? saved.includes(x.id) : x.category === active),
  );
}
function readingTime(items) {
  return Math.max(
    1,
    Math.ceil(
      items.reduce(
        (n, x) =>
          n +
          (
            (
              x.title +
              " " +
              x.summary +
              " " +
              (x.why || "A grounded significance explanation is pending.")
            ).match(/[\p{L}\p{N}_'-]+/gu) || []
          ).length,
        0,
      ) / 180,
    ),
  );
}

function safeURL(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}
function validItem(x) {
  return (
    x &&
    ["id", "title", "summary", "url", "source", "category", "published"].every(
      (k) => typeof x[k] === "string",
    ) &&
    safeURL(x.url) &&
    CATS.includes(x.category) &&
    !["All", "Saved"].includes(x.category) &&
    !isNaN(new Date(x.published)) &&
    (!x.why || typeof x.why === "string")
  );
}
function sourceDetails(item) {
  const sources = Array.isArray(item.sources)
    ? item.sources.filter((s) => s && safeURL(s.url))
    : [];
  const authors = Array.isArray(item.authors)
    ? item.authors.filter((a) => typeof a === "string")
    : [];
  return `<details class="source-details"><summary>Source &amp; evidence</summary>${authors.length ? `<p>${esc(authors.slice(0, 8).join("; "))}${authors.length > 8 ? " et al." : ""}</p>` : ""}<p>${esc(item.original_title || item.title)}</p>${sources.map((s) => `<p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.publisher)} ↗</a> · ${esc(s.content_type)} · ${esc(dateText(s.published, s.date_precision === "day"))}</p>`).join("")}${Array.isArray(item.technical_details) && item.technical_details.length ? `<h4>Technical detail</h4>${item.technical_details.map((t) => `<p>${esc(t)}</p>`).join("")}` : ""}${item.continuity_note ? `<p>${esc(item.continuity_note)}</p>` : ""}${item.corroboration ? `<p>${esc(item.corroboration)}</p>` : ""}${item.previous_report && safeURL(item.previous_report.url) ? `<p>Previous report: <a href="${esc(item.previous_report.url)}" target="_blank" rel="noopener noreferrer">${esc(item.previous_report.title)} ↗</a></p>` : ""}${item.selection_reason ? `<p>Selection: ${esc(item.selection_reason)}</p>` : ""}${item.development ? `<p>Development: ${esc(item.development)}</p>` : ""}${item.selection_method ? `<p>${esc(item.selection_method)}</p>` : ""}</details>`;
}

function coverageNote() {
  const stats = data.category_availability;
  if (active !== "All" || !stats) return "";
  const missing = Object.entries(stats)
    .filter(([cat, v]) => !v.daily_selected)
    .map(([cat, v]) => `${cat}: ${v.explanation}`);
  const pending = data.items.filter((x) => x.daily !== false && !x.ai_summary).length;
  return `<p class="coverage-note">${pending ? `${pending} ${pending === 1 ? "explanation is" : "explanations are"} pending. Listen plays complete explanations only. ` : ""}${missing.map(esc).join(" ")}</p>`;
}
function temp(v) {
  return v == null ? "—" : `${Math.round(v)}°`;
}
function rainWindows(hourly) {
  if (!hourly?.time) return [];
  const zones = [];
  let start = null,
    last = null,
    max = 0;
  hourly.time.forEach((raw, i) => {
    const d = new Date(raw);
    if (isNaN(d)) return;
    const day = new Date();
    if (
      d.getFullYear() !== day.getFullYear() ||
      d.getMonth() !== day.getMonth() ||
      d.getDate() !== day.getDate()
    )
      return;
    const p = hourly.precipitation_probability?.[i] ?? 0;
    const amount = hourly.precipitation?.[i] ?? 0;
    const possible = p >= 35 || amount >= 0.2;
    if (possible) {
      if (!start) start = d;
      last = d;
      max = Math.max(max, p);
    } else if (start) {
      zones.push({ start, last, max });
      start = null;
      last = null;
      max = 0;
    }
  });
  if (start) zones.push({ start, last, max });
  return zones;
}
function hour(d) {
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", hour12: true })
    .replace(" ", "")
    .toLowerCase();
}
function weatherHTML() {
  if (weatherBusy)
    return `<div class="weather-line"><div class="weather-copy"><span>Loading forecast…</span></div></div>`;
  if (weather) {
    let day = weather.daily,
      windows = rainWindows(weather.hourly),
      peak = day.precipitation_probability_max?.[0],
      rain = windows.length
        ? windows
            .map((w) => `${hour(w.start)}–${hour(new Date(w.last.getTime() + 3600000))}`)
            .join(", ")
        : peak >= 35
          ? "showers possible"
          : "no rain expected";
    return `<div class="weather-line"><div class="weather-copy"><strong>${esc(weather.place)}</strong><span>${temp(day.temperature_2m_max?.[0])} / ${temp(day.temperature_2m_min?.[0])}</span><span>${windows.length ? "rain " + esc(rain) : esc(rain)}${peak ? ` · ${peak}%` : ""}</span></div><button class="weather-change" id="weather-change">Change city</button></div>`;
  }
  return `<div class="weather-line"><div class="weather-copy"><strong>Weather</strong><span>${esc(weatherError || "Add your city for the high, low and rain times.")}</span></div><button class="weather-change" id="weather-change">Set city</button></div>`;
}
function dayText(date) {
  return new Date(date + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function awayHTML() {
  if (active !== "All" || !away?.stories.length) return "";
  const days = away.missedDays;
  const span =
    days.length === 1
      ? dayText(days[0])
      : `${dayText(days[0])} – ${dayText(days[days.length - 1])}`;
  return `<section class="away" aria-label="Key stories you missed"><div class="away-head"><div><span class="eyebrow">While you were away</span><h2>You missed ${days.length} ${days.length === 1 ? "briefing" : "briefings"}.</h2><p class="away-sub">${esc(span)} · ${away.stories.length} key ${away.stories.length === 1 ? "story" : "stories"}</p></div><button class="btn" id="caught-up">Mark caught up</button></div>${away.stories
    .map(
      (s) =>
        `<article class="away-card" data-event="${esc(s.event_key || s.id)}"><div class="story-topline"><span class="tag">${esc(s.category)}</span><span class="date">From ${esc(dayText(s.from))}</span></div><h3>${esc(s.display_title || s.title)}</h3><p class="summary">${esc(s.summary)}</p>${s.why ? `<div class="why"><span>Why it matters</span><p>${esc(s.why)}</p></div>` : ""}${safeURL(s.url) ? `<a class="source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Read original · ${esc(s.source || "Source")} <span aria-hidden="true">↗</span></a>` : ""}</article>`,
    )
    .join("")}</section>`;
}
function markRead() {
  const date = data.briefing_date;
  if (!date || missedState.readDays.includes(date)) return;
  missedState.readDays.push(date);
  MissedBriefings.save(localStorage, missedState);
}
function caughtUp(keys) {
  keys.forEach((k) => k && !missedState.caughtUp.includes(k) && missedState.caughtUp.push(k));
  MissedBriefings.save(localStorage, missedState);
}
function computeAway() {
  if (!data.briefing_date) return;
  if (!missedState.since) {
    // Days before this device first opened the app are not "missed".
    missedState.since = data.briefing_date;
    MissedBriefings.save(localStorage, missedState);
  }
  const todayKeys = data.items.filter((x) => x.daily !== false).map((x) => x.event_key || x.id);
  away = recap ? MissedBriefings.pick(recap, missedState, data.briefing_date, todayKeys) : null;
}
function watchReading() {
  if (!("IntersectionObserver" in window)) return;
  const daily = data.items.filter((x) => x.daily !== false).length;
  observer = new IntersectionObserver(
    (entries, self) => {
      for (const entry of entries) {
        if (entry.intersectionRatio < 0.6) continue;
        const el = entry.target;
        if (el.dataset.event) caughtUp([el.dataset.event]);
        else if (el.dataset.id) {
          seenToday.add(el.dataset.id);
          try {
            localStorage.setItem(
              "morning-brief:seen",
              JSON.stringify({ date: data.briefing_date, ids: [...seenToday] }),
            );
          } catch {}
        }
        self.unobserve(el);
      }
      // Seeing at least half of today's cards counts as reading the briefing.
      if (daily && seenToday.size >= Math.ceil(daily / 2)) markRead();
      updateWafer();
    },
    { threshold: 0.6 },
  );
  document.querySelectorAll(".away-card").forEach((el) => observer.observe(el));
  if (active === "All")
    document.querySelectorAll("#feed [data-id]").forEach((el) => {
      if (!seenToday.has(el.dataset.id)) observer.observe(el);
    });
}
// Story markup shared by the full cards and the expandable skim-mode rows.
function aiNote(item) {
  return item.ai_summary
    ? `<span class="ai-note">${item.summary_status === "cached_compacted" ? "AI summary, shortened · check the source" : "AI summary · check the source"}</span>`
    : `<span class="ai-note pending">Summary not ready · not read aloud</span>`;
}
function whyHTML(item) {
  return `<div class="why"><span>Why it matters</span><p>${esc(item.why || "A grounded significance explanation is pending.")}</p></div>`;
}
function footerHTML(item) {
  return `<div class="story-footer"><a class="source" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Read on ${esc(item.source || "source")} <span aria-hidden="true">↗</span></a>${item.ai_summary ? `<button class="ask" data-talk-story="${esc(item.id)}">Ask about this</button>` : ""}<button class="save ${saved.includes(item.id) ? "saved" : ""}" data-save="${esc(item.id)}" aria-pressed="${saved.includes(item.id)}">${saved.includes(item.id) ? "Saved" : "Save"}</button></div>`;
}
const trackAttr = (item) => (active === "All" ? ` data-id="${esc(item.id)}"` : "");
function continuityLabel(item) {
  // "New" is the normal case; only label the exceptions.
  return item.continuity && item.continuity !== "New"
    ? `<span class="continuity-label">${esc(item.continuity)}</span>`
    : "";
}
function storyCard(item) {
  return `<article class="story"${trackAttr(item)}><div class="story-topline"><span class="tag">${esc(item.category)}</span><span class="date">${esc(item.source || "")} · ${esc(dateText(item.published, item.publication_date_precision === "day"))}</span></div><h3>${esc(item.display_title || item.title)}</h3>${continuityLabel(item)}<p class="publication-type">${esc(item.publication_type || "Source report")}</p><p class="summary">${esc(item.summary)}</p>${whyHTML(item)}${aiNote(item)}${sourceDetails(item)}${footerHTML(item)}</article>`;
}
function lede(text) {
  const m = String(text || "").match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : String(text || "")).trim();
}
function storyRow(item) {
  const open = expanded.has(item.id);
  return `<article class="row ${open ? "open" : ""}"${trackAttr(item)}><button class="row-head" data-expand="${esc(item.id)}" aria-expanded="${open}"><span class="story-topline"><span class="tag">${esc(item.category)}</span><span class="date">${esc(item.source || "")} · ${esc(dateText(item.published, item.publication_date_precision === "day"))}</span></span><span class="row-title">${esc(item.display_title || item.title)}</span>${open ? "" : `<span class="row-lede">${esc(lede(item.summary))}</span>`}</button>${open ? `<div class="row-body">${continuityLabel(item)}<p class="summary">${esc(item.summary)}</p>${aiNote(item)}${whyHTML(item)}${sourceDetails(item)}${footerHTML(item)}</div>` : ""}</article>`;
}
// Line icons drawn in the button's text color (text symbols render as emoji on iPhone).
const ICON_LISTEN = `<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.6"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.6"/></svg>`;
const ICON_TALK = `<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/></svg>`;
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// The door to the Gita room (gita/). It reads the small summary the room saves.
function gitaCard() {
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem("gita:summary"));
  } catch {}
  const streak = g?.streak ? ` · ${g.streak}-day streak` : "";
  const [line, action] = !g
    ? ["A daily verse with Swami Chinmayananda's Holy Geeta", "Begin"]
    : g.kind === "new"
      ? [`Day ${g.day} · ${g.ref}${streak}`, "Today's verse"]
      : g.kind === "done"
        ? [`Day ${g.day} · ${g.ref} complete${streak}`, "Read again"]
        : ["All 100 days studied", "Open"];
  return `<a class="gita-card" href="gita/"><span class="gita-label">Bhagavad Gita</span><span class="gita-line">${esc(line)}</span><span class="gita-go">${action} →</span></a>`;
}
function heroDate() {
  const date = data.briefing_date ? new Date(data.briefing_date + "T12:00:00") : new Date();
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  const day = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return `${esc(weekday)}<em>${esc(day)}</em>`;
}
function editionLine() {
  if (!data.briefing_date) return "Waiting for the first briefing";
  if (data.briefing_date === todayISO()) return "Today's briefing";
  const yesterday = new Date(Date.now() - 864e5);
  const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  return data.briefing_date === y ? "Yesterday's briefing" : "Latest briefing";
}
// Signature: a sun that rises above the horizon as today's stories are read.
function readFraction() {
  const daily = data.items.filter((x) => x.daily !== false).length;
  if (!daily) return 0;
  return Math.min(1, seenToday.size / daily);
}
function waferLabel() {
  const daily = data.items.filter((x) => x.daily !== false).length;
  if (!daily) return "";
  const read = Math.round(readFraction() * daily);
  return read >= daily ? "All read" : `${read} of ${daily} read`;
}
function sunLift(fraction) {
  // At 0 only the sun's top edge shows above the horizon; fully read, it has cleared it.
  return -(7 + fraction * 33).toFixed(1); // A sliver shows before you start.
}
function waferSVG() {
  const f = readFraction();
  return `<svg class="sunrise" viewBox="0 0 120 64" aria-hidden="true"><defs><clipPath id="sky"><rect x="0" y="0" width="120" height="46"/></clipPath><radialGradient id="glow"><stop offset="0" stop-color="#efe2c2" stop-opacity="0.4"/><stop offset="1" stop-color="#efe2c2" stop-opacity="0"/></radialGradient></defs><g clip-path="url(#sky)"><g class="sun-body" style="transform:translateY(${sunLift(f)}px)"><circle cx="60" cy="64" r="34" fill="url(#glow)"/><circle class="sun" cx="60" cy="64" r="16"/></g></g><line class="horizon" x1="4" y1="46" x2="116" y2="46"/></svg>`;
}
function updateWafer() {
  const body = document.querySelector(".sunrise .sun-body");
  if (body) body.style.transform = `translateY(${sunLift(readFraction())}px)`;
  const label = document.querySelector("#wafer-label");
  if (label) label.textContent = waferLabel();
}
function render() {
  const items = visible(),
    all = data.items;
  if (observer) observer.disconnect();
  app.innerHTML = `<div class="shell"><header class="top"><span class="brand">Morning Brief</span><button class="alerts-button" data-notify aria-label="Morning alert settings">Alerts</button></header>
  <section class="hero"><div class="hero-copy"><p class="edition-line">${esc(editionLine())}</p><h1>${heroDate()}</h1></div><div class="sun-wrap">${waferSVG()}<span class="wafer-label" id="wafer-label">${esc(waferLabel())}</span></div></section>
  <div class="weather-wrap">${weatherHTML()}</div>${weatherEditing ? `<div class="weather-form"><input id="weather-city" autocomplete="address-level2" placeholder="City, e.g. Ann Arbor" value="${esc(weatherCity)}" aria-label="Weather city"><button class="btn primary" id="weather-search">Find city</button><button class="btn" id="weather-locate">Use my location</button></div>` : ""}
  <div class="hero-actions"><button class="listen-button" id="listen">${ICON_LISTEN}Listen</button><button class="listen-button talk-button" data-talk>${ICON_TALK}Talk</button></div>${gitaCard()}
  <nav class="tabs" aria-label="Sections">${CATS.map((c) => `<button class="tab ${active === c ? "active" : ""}" data-cat="${esc(c)}">${c === "All" ? "Today" : esc(c)}</button>`).join("")}</nav>
  <section class="digest-head"><span class="digest-meta">${items.length} ${items.length === 1 ? "story" : "stories"} · ${readingTime(items)} min</span><span class="view-toggle" role="group" aria-label="Layout"><button data-view="cards" class="${view === "cards" ? "active" : ""}" aria-pressed="${view === "cards"}">Cards</button><button data-view="list" class="${view === "list" ? "active" : ""}" aria-pressed="${view === "list"}">List</button></span></section>
  ${coverageNote()}${awayHTML()}<div class="feed ${view === "list" ? "list" : ""}" id="feed">${items.length ? items.map((item, i) => (view === "list" ? storyRow(item) : storyCard(item))).join("") : `<div class="empty">${active === "Saved" ? "Nothing saved yet. Tap Save on a story to keep it here." : all.length ? esc(data.category_availability?.[active]?.explanation || "No qualified stories in this section right now.") : "No briefing has been published yet. The first one arrives after the next morning run."}</div>`}</div>${active === "All" && items.length && view === "cards" ? `<p class="feed-end">End of today's briefing</p>` : ""}<footer class="foot"><button class="refresh" id="refresh">Check for updates</button><p>Summaries are written by AI from the linked sources. Check the original before relying on a detail.</p><span>Updated ${esc(dateText(data.generated_at))}</span></footer></div>${voice.on ? `<div class="player"><div class="player-copy"><b>♫ Listening</b><small>${esc(data.items[voice.ids[voice.index]]?.display_title || data.items[voice.ids[voice.index]]?.title || "Briefing complete")}</small></div><div class="player-controls"><button id="previous" aria-label="Previous story">◂</button><button id="pause" aria-label="${voice.paused ? "Resume" : "Pause"}">${voice.paused ? "▶" : "Ⅱ"}</button><button id="next" aria-label="Next story">▸</button><button id="stop" aria-label="Stop listening">✕</button></div></div>` : ""}`;
  document.querySelectorAll("[data-cat]").forEach(
    (b) =>
      (b.onclick = () => {
        active = b.dataset.cat;
        render();
        document
          .querySelector(".digest-head")
          .scrollIntoView({ behavior: "smooth", block: "start" });
      }),
  );
  document.querySelectorAll("[data-save]").forEach(
    (b) =>
      (b.onclick = () => {
        saved = saved.includes(b.dataset.save)
          ? saved.filter((x) => x !== b.dataset.save)
          : [...saved, b.dataset.save];
        localStorage.setItem(KEY, JSON.stringify(saved));
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
      }),
  );
  document.querySelector("#refresh").onclick = fetchData;
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        view = b.dataset.view;
        try {
          localStorage.setItem("morning-brief:view", view);
        } catch {}
        render();
      }),
  );
  document.querySelectorAll("[data-expand]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.expand;
        expanded.has(id) ? expanded.delete(id) : expanded.add(id);
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
      }),
  );
  const caught = document.querySelector("#caught-up");
  if (caught)
    caught.onclick = () => {
      caughtUp(away.stories.map((s) => s.event_key || s.id));
      away.missedDays.forEach(
        (d) => missedState.readDays.includes(d) || missedState.readDays.push(d),
      );
      MissedBriefings.save(localStorage, missedState);
      away = null;
      render();
    };
  watchReading();
  document.querySelector("#listen").onclick = () => {
    if (!document.dispatchEvent(new Event("request-michael", { cancelable: true }))) return;
    startBrowserNarration();
  };
  function startBrowserNarration() {
    document.dispatchEvent(new Event("browser-narration-play"));
    const list = visible().filter((x) => x.ai_summary && x.why);
    if (!list.length) {
      alert(
        "No complete explanations are ready to narrate in this tab. Pending stories are not read aloud.",
      );
      return;
    }
    voice.ids = list.map((x) => data.items.indexOf(x));
    voice.index = 0;
    voice.on = true;
    voice.paused = false;
    speak();
  }
  window.startBrowserNarration = startBrowserNarration;
  const wc = document.querySelector("#weather-change");
  if (wc)
    wc.onclick = () => {
      weatherEditing = !weatherEditing;
      render();
    };
  const wcInput = document.querySelector("#weather-city");
  if (wcInput) {
    wcInput.onkeydown = (e) => {
      if (e.key === "Enter") lookupWeather(wcInput.value);
    };
    document.querySelector("#weather-search").onclick = () => lookupWeather(wcInput.value);
    document.querySelector("#weather-locate").onclick = locateWeather;
  }
  if (voice.on) {
    document.querySelector("#previous").onclick = () => {
      voice.index = Math.max(0, voice.index - 1);
      speak();
    };
    document.querySelector("#next").onclick = next;
    document.querySelector("#stop").onclick = stop;
    document.querySelector("#pause").onclick = () => {
      if (voice.paused) {
        speechSynthesis.resume();
        voice.paused = false;
      } else {
        speechSynthesis.pause();
        voice.paused = true;
      }
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    };
  }
}
async function loadForecast(lat, lon, place) {
  weatherBusy = true;
  weatherError = "";
  render();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&hourly=precipitation_probability,precipitation&temperature_unit=fahrenheit&precipitation_unit=mm&timezone=auto&forecast_days=2`;
    const r = await fetch(url);
    if (!r.ok) throw Error("Forecast currently unavailable");
    const v = await r.json();
    weather = { ...v, place };
    weatherEditing = false;
  } catch (e) {
    weatherError = e.message;
  } finally {
    weatherBusy = false;
    render();
  }
}
async function lookupWeather(city) {
  if (!city.trim()) return;
  weatherCity = city.trim();
  localStorage.setItem(CITYKEY, weatherCity);
  weatherBusy = true;
  render();
  try {
    const r = await fetch(
      "https://geocoding-api.open-meteo.com/v1/search?name=" +
        encodeURIComponent(weatherCity) +
        "&count=1&language=en&format=json",
    );
    if (!r.ok) throw Error("City lookup failed");
    const v = await r.json();
    const p = v.results?.[0];
    if (!p) throw Error("City not found. Try adding a state or country.");
    await loadForecast(p.latitude, p.longitude, `${p.name}${p.admin1 ? ", " + p.admin1 : ""}`);
  } catch (e) {
    weatherError = e.message;
    weatherBusy = false;
    weatherEditing = true;
    render();
  }
}
function locateWeather() {
  if (!navigator.geolocation) {
    weatherError = "Location unavailable; enter your city.";
    render();
    return;
  }
  weatherBusy = true;
  render();
  navigator.geolocation.getCurrentPosition(
    (p) => {
      weatherCity = "";
      localStorage.removeItem(CITYKEY);
      loadForecast(p.coords.latitude, p.coords.longitude, "My location");
    },
    () => {
      weatherBusy = false;
      weatherEditing = true;
      weatherError = "Location was not shared. Enter your city instead.";
      render();
    },
    { timeout: 10000, maximumAge: 1800000 },
  );
}
function speak() {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis unavailable.");
    stop();
    return;
  }
  speechSynthesis.cancel();
  const x = data.items[voice.ids[voice.index]];
  if (!x) {
    stop();
    return;
  }
  const u = new SpeechSynthesisUtterance(
    `${x.category}. ${x.display_title || x.title}. ${x.summary}. ${x.why ? "Why it matters: " + x.why : ""}`,
  );
  u.rate = 1.02;
  u.onend = () => {
    if (voice.on && !voice.paused) next();
  };
  u.onerror = (e) => {
    if (e.error !== "interrupted" && voice.on) stop();
  };
  voice.paused = false;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
  speechSynthesis.speak(u);
}
function next() {
  voice.index++;
  markRead(); // Listening past the first story counts as reading.
  if (voice.index >= voice.ids.length) stop();
  else speak();
}
function stop() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  voice.on = false;
  voice.paused = false;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}
async function fetchData() {
  try {
    const r = await fetch("data/latest.json?ts=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw Error("Unavailable");
    const json = await r.json();
    if (!Array.isArray(json.items)) throw Error("Invalid feed");
    if (voice.on) stop();
    data = { ...json, items: json.items.filter(validItem) };
    if (json.briefing_date !== seenToday.date) {
      let stored = {};
      try {
        stored = JSON.parse(localStorage.getItem("morning-brief:seen")) || {};
      } catch {}
      const ids = stored.date === json.briefing_date && Array.isArray(stored.ids) ? stored.ids : [];
      seenToday = Object.assign(new Set(ids), { date: json.briefing_date });
    }
    try {
      const r2 = await fetch("data/recap.json?ts=" + Date.now(), { cache: "no-store" });
      recap = r2.ok ? await r2.json() : null;
    } catch {
      recap = null;
    }
    computeAway();
    render();
  } catch (e) {
    if (!data.items.length) {
      data = { generated_at: null, items: [] };
      render();
    } else {
      alert("Could not check for updates. Your current briefing is still available.");
    }
  }
}
render();
fetchData();
if (weatherCity) lookupWeather(weatherCity);
// When a newer version of the app takes over, reload once (not during a conversation).
if ("serviceWorker" in navigator) {
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled && !(window.Talk && Talk.state() !== "closed")) location.reload();
    controlled = true;
  });
}
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {}),
  );

document.addEventListener("file-audio-play", () => {
  if (voice.on) stop();
});

document.addEventListener("request-browser-narration", () => window.startBrowserNarration?.());
document.addEventListener("briefing-listened", markRead);
document.addEventListener("talk-start", () => {
  if (voice.on) stop();
});
