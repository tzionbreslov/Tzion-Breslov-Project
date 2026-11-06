// Ordering, search and dates for the Classes video library. Shared by the
// server markup (lib/pages/classes.ts) and the browser (lib/client/video-library.ts),
// so the page opens in exactly the order the "Latest" button gives.

const time = (video) => Date.parse(video.published);
const hasViews = (video) => typeof video.views === "number";
const byTitle = (a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
const newestFirst = (a, b) => time(b) - time(a) || byTitle(a, b);

const ORDERS = {
  latest: newestFirst,
  oldest: (a, b) => time(a) - time(b) || byTitle(a, b),
  // Counted videos first, most viewed first; uncounted ones after, newest first.
  popular: (a, b) => {
    if (hasViews(a) !== hasViews(b)) return hasViews(a) ? -1 : 1;
    return (hasViews(a) ? b.views - a.views : 0) || newestFirst(a, b);
  }
};

/** A sorted copy of `videos` (the input is left as it is). */
export function sortVideos(videos, order) {
  const compare = ORDERS[order];
  if (!compare) throw new Error(`unknown video order: ${order}`);
  return [...videos].sort(compare);
}

/** The videos whose title contains `query` (trimmed, any case); all of them for an empty query. */
export function filterVideos(videos, query) {
  const needle = query.trim().toLowerCase();
  return needle ? videos.filter((video) => video.title.toLowerCase().includes(needle)) : [...videos];
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Nov 2026" */
export function formatMonthYear(iso) {
  return monthYear.format(new Date(iso));
}
