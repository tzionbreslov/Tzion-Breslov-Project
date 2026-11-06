import assert from "node:assert/strict";
import test from "node:test";
import { mergeYouTubeVideos, parseYouTubeFeed } from "./lib/youtube-feed.mjs";

const channelId = "UC69mDA498p7l9GGBdaUdkkA";
const entry = (id, title, published, channel = channelId) => `
  <entry>
    <yt:videoId>${id}</yt:videoId>
    <yt:channelId>${channel}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
    <published>${published}</published>
  </entry>`;
const feed = (...entries) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entries.join("")}
</feed>`;

test("parses and validates the channel feed", () => {
  const xml = feed(entry("vNDPR3LKjn4", "Unlimited I Rav David &amp; Kalmus &#x1F525;", "2026-11-03T12:30:00+00:00"));
  assert.deepEqual(parseYouTubeFeed(xml, channelId), [{
    id: "vNDPR3LKjn4",
    title: "Unlimited I Rav David & Kalmus 🔥",
    published: "2026-11-03T12:30:00.000Z"
  }]);
});

test("rejects feeds that could corrupt the catalog", () => {
  assert.throws(() => parseYouTubeFeed(feed(entry("vNDPR3LKjn4", "x", "2026-11-03T00:00:00Z", "UC0000000000000000000000")), channelId), /unexpected channel/);
  assert.throws(() => parseYouTubeFeed(feed(entry("bad id!", "x", "2026-11-03T00:00:00Z")), channelId), /invalid video ID/);
  assert.throws(() => parseYouTubeFeed(feed(entry("vNDPR3LKjn4", "x", "not a date")), channelId), /invalid publication date/);
  assert.throws(() => parseYouTubeFeed(feed(), channelId), /no public uploads/);
  assert.throws(() => parseYouTubeFeed("<html>404</html>", channelId), /no public uploads/);
});

test("adds new uploads, refreshes titles and keeps the archive", () => {
  const current = [
    { id: "rQo5snk6TRM", title: "Old title", published: "2026-11-01T00:00:00.000Z" },
    { id: "z7PeNsdItyY", title: "Archived, no longer in the feed", published: "2024-08-15T00:00:00.000Z" }
  ];
  const incoming = [
    { id: "vNDPR3LKjn4", title: "Unlimited", published: "2026-11-03T00:00:00.000Z" },
    { id: "rQo5snk6TRM", title: "Rise Above the Impossible", published: "2026-11-01T00:00:00.000Z" }
  ];
  const { videos, added } = mergeYouTubeVideos(current, incoming);
  assert.deepEqual(added, ["vNDPR3LKjn4"]);
  assert.deepEqual(videos.map((v) => v.id), ["vNDPR3LKjn4", "rQo5snk6TRM", "z7PeNsdItyY"]);
  assert.equal(videos[1].title, "Rise Above the Impossible");
});
