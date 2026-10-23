/* Progress for the Gita practice: which day is next, the streak, spaced reviews, stars.
   Pure functions on a plain object, so they are easy to test; app.mjs saves the object
   in localStorage. Missed days simply mean the next session picks up where you left off. */

export const INTERVALS = [1, 3, 7, 14, 30]; // days between reviews, one step per "Remembered"
export const MAX_RECALL = 3;

export function emptyProgress() {
  return {
    version: 1,
    nextDay: 1, // the next new day to study
    completed: {}, // day number -> date (YYYY-MM-DD) it was completed
    streak: { count: 0, lastDate: "" },
    reviews: {}, // day number -> { step, due }
    starred: [], // day numbers
    since: "", // first session date
  };
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

const daysBetween = (a, b) =>
  Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);

/** What today's session is: a new day, or today's already completed. */
export function todayPlan(progress, totalDays, today = isoDate()) {
  const doneToday = Object.entries(progress.completed).find(([, date]) => date === today);
  if (doneToday) return { kind: "done", day: Number(doneToday[0]) };
  if (progress.nextDay > totalDays) return { kind: "finished" };
  return { kind: "new", day: progress.nextDay };
}

/** Up to three due reviews, most overdue first, never the day being studied. */
export function dueReviews(progress, today = isoDate(), exclude = null) {
  return Object.entries(progress.reviews)
    .map(([day, r]) => ({ day: Number(day), ...r, overdue: daysBetween(r.due, today) }))
    .filter((r) => r.overdue >= 0 && r.day !== exclude)
    .sort((a, b) => b.overdue - a.overdue || a.day - b.day)
    .slice(0, MAX_RECALL);
}

/** Remembered moves up a step, Fuzzy stays, Forgot resets to one day. */
export function gradeReview(progress, day, grade, today = isoDate()) {
  const r = progress.reviews[day] || { step: 0, due: today };
  let step = r.step;
  if (grade === "remembered") step = Math.min(step + 1, INTERVALS.length - 1);
  if (grade === "forgot") step = 0;
  progress.reviews[day] = { step, due: addDays(today, INTERVALS[step]), last: today };
  return progress;
}

/** Mark a day studied: it enters the review cycle and the streak advances. */
export function completeDay(progress, day, today = isoDate()) {
  if (!progress.since) progress.since = today;
  if (!progress.completed[day]) {
    progress.completed[day] = today;
    progress.reviews[day] = { step: 0, due: addDays(today, INTERVALS[0]) };
    if (day >= progress.nextDay) progress.nextDay = day + 1;
  }
  const last = progress.streak.lastDate;
  if (last !== today) {
    progress.streak.count = last && daysBetween(last, today) === 1 ? progress.streak.count + 1 : 1;
    progress.streak.lastDate = today;
  }
  return progress;
}

/** The streak shown today (a gap of more than a day quietly resets it to 0). */
export function currentStreak(progress, today = isoDate()) {
  const last = progress.streak.lastDate;
  if (!last) return 0;
  return daysBetween(last, today) <= 1 ? progress.streak.count : 0;
}

export function toggleStar(progress, day) {
  const set = new Set(progress.starred);
  set.has(day) ? set.delete(day) : set.add(day);
  progress.starred = [...set].sort((a, b) => a - b);
  return progress;
}

/** Saturday or Sunday, with at least two days studied: offer the recap of the last seven. */
export function recapDays(progress, today = isoDate()) {
  const weekday = new Date(today + "T12:00:00").getDay();
  if (weekday !== 0 && weekday !== 6) return [];
  const done = Object.keys(progress.completed)
    .map(Number)
    .sort((a, b) => a - b);
  return done.length >= 2 ? done.slice(-7) : [];
}

/** Small summary the briefing's Gita card reads (same origin, same storage). */
export function summary(progress, days, today = isoDate()) {
  const plan = todayPlan(progress, days.length, today);
  const day =
    plan.kind === "new" ? days[plan.day - 1] : plan.kind === "done" ? days[plan.day - 1] : null;
  return {
    kind: plan.kind,
    day: day?.day || null,
    ref: day?.ref || "",
    streak: currentStreak(progress, today),
    studied: Object.keys(progress.completed).length,
    total: days.length,
    due: dueReviews(progress, today).length,
  };
}
