import assert from "node:assert/strict";
import test from "node:test";
import { filterVideos, formatMonthYear, sortVideos } from "../lib/video-library.mjs";

const ids = (videos) => videos.map((video) => video.id);

// youtube.json dates carry "+00:00", shorts.json dates "Z": compared as times, not strings.
const library = [
  { id: "a", title: "Unlimited I Rav David Yisrael Kalmus", published: "2026-11-03T22:09:52+00:00", views: 120 },
  { id: "b", title: "Rise Above the Impossible", published: "2026-11-01T16:17:05+00:00" },
  { id: "c", title: "Joy is the Key", published: "2024-08-26T10:48:45.000Z", views: 4000 },
  { id: "d", title: "Rabbi Kalmus Daily Ray of Wisdom: What is Bitul?", published: "2023-06-29T08:08:35Z", views: 120 },
  { id: "e", title: "Climb, But Hold On", published: "2026-10-26T19:28:18+00:00" }
];

test("latest: newest first", () => {
  assert.deepEqual(ids(sortVideos(library, "latest")), ["a", "b", "e", "c", "d"]);
});

test("oldest: oldest first", () => {
  assert.deepEqual(ids(sortVideos(library, "oldest")), ["d", "c", "e", "b", "a"]);
});

test("popular: most views first, ties newest first, videos without a count after every counted one", () => {
  assert.deepEqual(ids(sortVideos(library, "popular")), ["c", "a", "d", "b", "e"]);
});

test("popular: a count of 0 is still a count", () => {
  const videos = [
    { id: "none", title: "No count", published: "2026-01-02T00:00:00Z" },
    { id: "zero", title: "Zero", published: "2020-01-01T00:00:00Z", views: 0 }
  ];
  assert.deepEqual(ids(sortVideos(videos, "popular")), ["zero", "none"]);
});

test("equal times are ordered by title", () => {
  const same = "2026-11-03T22:09:52+00:00";
  const videos = [
    { id: "z", title: "Zeal", published: same },
    { id: "m", title: "Mercy", published: "2026-11-03T22:09:52Z" },
    { id: "b", title: "Bitachon", published: same }
  ];
  assert.deepEqual(ids(sortVideos(videos, "latest")), ["b", "m", "z"]);
  assert.deepEqual(ids(sortVideos(videos, "oldest")), ["b", "m", "z"]);
});

test("sorting leaves the input untouched", () => {
  const input = [...library];
  sortVideos(input, "oldest");
  sortVideos(input, "popular");
  assert.deepEqual(input, library);
});

test("filterVideos: trimmed, case-insensitive substring of the title; empty query keeps all", () => {
  assert.deepEqual(ids(filterVideos(library, "bitul")), ["d"]);
  assert.deepEqual(ids(filterVideos(library, "  RAV david ")), ["a"]);
  assert.deepEqual(ids(filterVideos(library, "")), ids(library));
  assert.deepEqual(ids(filterVideos(library, "   ")), ids(library));
  assert.deepEqual(filterVideos(library, "no such class"), []);
});

test("formatMonthYear: short month and year in UTC", () => {
  assert.equal(formatMonthYear("2026-11-03T22:09:52+00:00"), "Nov 2026");
  // 23:30 on 31 Dec in New York is already January in UTC.
  assert.equal(formatMonthYear("2023-12-31T23:30:00-05:00"), "Jan 2024");
  assert.equal(formatMonthYear("2023-06-29T10:01:04Z"), "Jun 2023");
});
