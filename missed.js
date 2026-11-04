/* Tracks which briefings this device has read and picks key stories from missed days.
   Everything stays in this browser's localStorage; nothing is sent anywhere. */
(function (root) {
  const READ_KEY = "morning-brief:read-days";
  const SINCE_KEY = "morning-brief:since";
  const CAUGHT_KEY = "morning-brief:caught-up";
  const MAX_STORIES = 10;
  const MAX_PER_CATEGORY = 4;

  // How many stories to show for a given number of missed days: 1 → 3, 2 → 5, 3 → 7, 5+ → 10.
  const storyLimit = (days) => Math.min(MAX_STORIES, 1 + 2 * days);

  function pick(recap, state, today, todayEventKeys) {
    const days = Array.isArray(recap?.days) ? recap.days : [];
    const read = new Set(state.readDays || []);
    const missed = days.filter(
      (d) =>
        d.date && (!state.since || d.date >= state.since) && d.date < today && !read.has(d.date),
    );
    // Anything already covered on a day you read, in today's edition, or already caught up on.
    const seen = new Set([...(todayEventKeys || []), ...(state.caughtUp || [])]);
    days
      .filter((d) => read.has(d.date))
      .forEach((d) => (d.event_keys || []).forEach((k) => seen.add(k)));
    const byEvent = new Map();
    for (const day of missed) {
      for (const story of day.stories || []) {
        const key = story.event_key || story.id;
        if (!key || seen.has(key)) continue;
        const candidate = { ...story, from: day.date };
        const existing = byEvent.get(key);
        if (!existing || candidate.from > existing.from) byEvent.set(key, candidate); // Keep the newest telling.
      }
    }
    const ranked = [...byEvent.values()].sort(
      (a, b) => (b.importance || 0) - (a.importance || 0) || b.from.localeCompare(a.from),
    );
    const perCategory = {};
    const stories = [];
    for (const story of ranked) {
      if (stories.length >= storyLimit(missed.length)) break;
      perCategory[story.category] = (perCategory[story.category] || 0) + 1;
      if (perCategory[story.category] > MAX_PER_CATEGORY) continue;
      stories.push(story);
    }
    stories.sort(
      (a, b) => b.from.localeCompare(a.from) || (b.importance || 0) - (a.importance || 0),
    );
    return { missedDays: missed.map((d) => d.date).sort(), stories };
  }

  function load(storage) {
    const get = (k, fallback) => {
      try {
        return JSON.parse(storage.getItem(k)) ?? fallback;
      } catch {
        return fallback;
      }
    };
    return {
      readDays: get(READ_KEY, []),
      since: get(SINCE_KEY, null),
      caughtUp: get(CAUGHT_KEY, []),
    };
  }

  function save(storage, state) {
    try {
      storage.setItem(READ_KEY, JSON.stringify(state.readDays.slice(-90)));
      if (state.since) storage.setItem(SINCE_KEY, JSON.stringify(state.since));
      storage.setItem(CAUGHT_KEY, JSON.stringify(state.caughtUp.slice(-400)));
    } catch {}
  }

  const api = { pick, load, save, storyLimit };
  if (typeof module !== "undefined") module.exports = api;
  else root.MissedBriefings = api;
})(this);
