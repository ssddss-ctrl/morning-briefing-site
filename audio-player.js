/* Experimental file audio, independent of the retained browser narrator. */
(async () => {
  const host = document.querySelector("#audio-prototype");
  const node = (tag, text) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    return n;
  };
  const details = node("details");
  details.className = "audio-prototype";
  details.append(node("summary", "Listen with Michael · Full briefing and voice samples"));
  const body = node("div");
  body.className = "audio-prototype-body";
  details.append(body);
  host.append(details);
  body.append(
    node(
      "p",
      "Michael is your selected narrator. The full briefing reads each story’s summary and why it matters. Short voice samples are available separately below.",
    ),
  );
  const select = node("select");
  select.setAttribute("aria-label", "Audio recording");
  let tracks = [];
  try {
    const r = await fetch("audio-samples.json");
    if (r.ok)
      tracks = (await r.json()).filter(
        (x) =>
          Array.isArray(x) &&
          typeof x[0] === "string" &&
          /^audio_samples\/[a-zA-Z0-9_-]+\.wav$/.test(x[1]),
      );
  } catch {}
  if (!tracks.length) tracks = [["Michael · sample", "audio_samples/kokoro_male_voice_1.wav"]];
  let edition = null,
    index = 0,
    mode = "sample",
    restoring = 0,
    loading = false,
    currentKey = "";
  const audio = node("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.setAttribute("playsinline", "");
  audio.id = "file-audio";
  const status = node("p", "Choose a recording and press Play.");
  status.setAttribute("role", "status");
  const title = node("p");
  title.className = "audio-current-story";
  tracks.forEach(([label], i) => {
    const o = node("option", label);
    o.value = String(i);
    select.append(o);
  });
  const speed = node("select");
  speed.setAttribute("aria-label", "Playback speed");
  [0.85, 1, 1.15, 1.3].forEach((v) => {
    const o = node("option", v + "×");
    o.value = v;
    o.selected = v === 1;
    speed.append(o);
  });
  const controls = node("div");
  controls.className = "audio-prototype-controls";
  const button = (label, fn) => {
    const b = node("button", label);
    b.className = "btn";
    b.onclick = fn;
    controls.append(b);
    return b;
  };
  const previous = button("Previous story", () => load(Math.max(0, index - 1), true));
  const next = button("Next story", () =>
    load(Math.min(edition.segments.length - 1, index + 1), true),
  );
  button("Use browser voice", () => {
    audio.pause();
    document.dispatchEvent(new Event("request-browser-narration"));
  });
  button("Restart", () => {
    if (mode === "edition") load(0, true, 0);
    else {
      audio.currentTime = 0;
      save();
      play();
    }
  });
  controls.prepend(select, speed);
  body.append(controls, title, audio, status);
  const storageKey = () =>
    "morning-brief:file-audio:" + (mode === "edition" ? edition.edition_hash : select.value);
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(storageKey())) || {};
    } catch {
      return {};
    }
  };
  function save() {
    if (loading) return;
    try {
      localStorage.setItem(
        currentKey,
        JSON.stringify({ index, time: audio.currentTime, rate: audio.playbackRate }),
      );
    } catch {}
  }
  function play() {
    audio.play().catch(() => {
      status.textContent = "Press Play to begin or resume this recording.";
    });
  }
  function load(i = 0, start = false, position = null) {
    loading = true;
    index = i;
    previous.disabled = next.disabled = mode !== "edition";
    if (mode === "edition") {
      previous.disabled = i === 0;
      next.disabled = i === edition.segments.length - 1;
    }
    const record =
      mode === "edition"
        ? edition.segments[i]
        : { url: tracks[Number(select.value)][1], title: tracks[Number(select.value)][0] };
    const saved = read();
    if (saved.rate && [0.85, 1, 1.15, 1.3].includes(saved.rate)) speed.value = saved.rate;
    restoring = position ?? (saved.index === i ? saved.time || 0 : 0);
    audio.pause();
    currentKey = storageKey();
    audio.src = record.url;
    audio.load();
    audio.playbackRate = Number(speed.value);
    title.textContent =
      (mode === "edition"
        ? "Listening · " +
          edition.briefing_date +
          " · " +
          (i + 1) +
          "/" +
          edition.segments.length +
          " · "
        : "Voice comparison · ") + record.title;
    status.textContent = "Ready. Press Play to listen.";
    updateLockScreen(record);
    if (start) play();
  }
  // Lock-screen and Control Center controls (Media Session API).
  const session = "mediaSession" in navigator ? navigator.mediaSession : null;
  function updateLockScreen(record) {
    if (!session || typeof MediaMetadata === "undefined") return;
    const inEdition = mode === "edition";
    session.metadata = new MediaMetadata({
      title: record.title,
      artist: inEdition
        ? `Morning Brief · story ${index + 1} of ${edition.segments.length}`
        : "Morning Brief · voice sample",
      album: inEdition ? "Briefing for " + edition.briefing_date : "Morning Brief",
      artwork: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
  }
  if (session) {
    const handlers = {
      play: () => play(),
      pause: () => audio.pause(),
      previoustrack: () => mode === "edition" && load(Math.max(0, index - 1), true, 0),
      nexttrack: () =>
        mode === "edition" && index < edition.segments.length - 1 && load(index + 1, true, 0),
      seekbackward: (d) =>
        (audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10))),
      seekforward: (d) =>
        (audio.currentTime = Math.min(
          audio.duration || 0,
          audio.currentTime + (d.seekOffset || 10),
        )),
      seekto: (d) => (audio.currentTime = d.seekTime),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action, handler);
      } catch {} // Some actions are unsupported on some browsers.
    }
    const position = () => {
      try {
        if (audio.duration && isFinite(audio.duration))
          session.setPositionState({
            duration: audio.duration,
            position: Math.min(audio.currentTime, audio.duration),
            playbackRate: audio.playbackRate,
          });
      } catch {}
    };
    audio.addEventListener("loadedmetadata", position);
    audio.addEventListener("seeked", position);
    audio.addEventListener("ratechange", position);
    audio.addEventListener("play", () => (session.playbackState = "playing"));
    audio.addEventListener("pause", () => (session.playbackState = "paused"));
  }
  audio.addEventListener("loadedmetadata", () => {
    if (restoring > 0 && restoring < audio.duration) audio.currentTime = restoring;
    restoring = 0;
    loading = false;
  });
  audio.addEventListener("timeupdate", save);
  audio.addEventListener("timeupdate", () => {
    // Listening past the first story (or 45 seconds into it) counts as reading today's briefing.
    if (mode === "edition" && (index >= 1 || audio.currentTime >= 45))
      document.dispatchEvent(new Event("briefing-listened"));
  });
  audio.addEventListener("pause", save);
  audio.addEventListener("play", () => {
    document.dispatchEvent(new Event("file-audio-play"));
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    status.textContent = "Listening. Keep this page open for foreground playback.";
  });
  audio.addEventListener("error", () => {
    loading = false;
    status.textContent =
      "This recording is unavailable. Try another sample or use the existing Listen button.";
  });
  audio.addEventListener("ended", () => {
    if (mode === "edition" && index < edition.segments.length - 1) load(index + 1, true, 0);
    else {
      status.textContent = "Recording complete.";
      audio.currentTime = 0;
      save();
    }
  });
  select.onchange = () => {
    try {
      localStorage.setItem("morning-brief:recording", select.value);
    } catch {}
    mode = select.value === "edition" ? "edition" : "sample";
    const saved = read();
    load(Math.min(saved.index || 0, mode === "edition" ? edition.segments.length - 1 : 0));
  };
  speed.onchange = () => {
    audio.playbackRate = Number(speed.value);
    save();
  };
  document.addEventListener("browser-narration-play", () => audio.pause());
  document.addEventListener("talk-start", () => audio.pause());
  let preferred = "edition";
  try {
    if (!localStorage.getItem("morning-brief:michael-selected")) {
      localStorage.setItem("morning-brief:michael-selected", "1");
      localStorage.setItem("morning-brief:recording", "edition");
    }
    preferred = localStorage.getItem("morning-brief:recording") || "edition";
  } catch {}
  if (["0", "1", "2"].includes(preferred)) select.value = preferred;
  load();
  try {
    const [r, b] = await Promise.all([
      fetch("audio_samples/edition.json", { cache: "no-store" }),
      fetch("data/latest.json", { cache: "no-store" }),
    ]);
    if (!r.ok || !b.ok) return;
    const candidate = await r.json(),
      brief = await b.json();
    const ids = new Set(
      brief.items.filter((x) => x.daily !== false && x.ai_summary && x.why).map((x) => x.id),
    );
    if (
      candidate.source_items &&
      JSON.stringify(candidate.source_items) !==
        JSON.stringify(
          brief.items
            .filter((x) => ids.has(x.id))
            .map((x) => ({ id: x.id, title: x.title, summary: x.summary, why: x.why })),
        )
    )
      return;
    if (
      candidate.briefing_date !== brief.briefing_date ||
      !candidate.segments?.length ||
      candidate.segments.some(
        (s) =>
          !ids.has(s.story_id) ||
          !/^audio_samples\/edition-[a-f0-9]+-am_(michael|fenrir)\/\d+\.(wav|mp3|m4a)$/.test(s.url),
      )
    )
      return;
    edition = candidate;
    document.addEventListener("request-michael", (event) => {
      event.preventDefault();
      details.open = true;
      select.value = "edition";
      mode = "edition";
      const saved = read();
      load(Math.min(saved.index || 0, edition.segments.length - 1), true);
      details.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const option = node(
      "option",
      "Full briefing · " +
        (candidate.voice === "am_michael" ? "Michael" : "Fenrir") +
        " · " +
        candidate.briefing_date,
    );
    option.value = "edition";
    select.append(option);
    if (preferred === "edition") {
      select.value = "edition";
      mode = "edition";
      load(Math.min(read().index || 0, edition.segments.length - 1));
    }
  } catch {
    status.textContent = "Voice samples available. Full briefing audio is not ready.";
  }
})();
