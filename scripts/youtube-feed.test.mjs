import assert from "node:assert/strict";
import test from "node:test";
import { mergeYouTubeVideos, parseYouTubeFeed } from "./lib/youtube-feed.mjs";

const channelId = "UC69mDA498p7l9GGBdaUdkkA";
const entry = (id, title, published, channel = channelId, extra = "") => `
  <entry>
    <yt:videoId>${id}</yt:videoId>
    <yt:channelId>${channel}</yt:channelId>
    <title>${title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
    <published>${published}</published>${extra}
  </entry>`;
// The media block YouTube's feed carries for each upload, with its public view count.
const media = (statistics) => `
    <media:group>
      <media:title>Media title</media:title>
      <media:thumbnail url="https://i.ytimg.com/vi/x/hqdefault.jpg" width="480" height="360"/>
      <media:community>
        <media:starRating count="7" average="5.00" min="1" max="5"/>
        ${statistics}
      </media:community>
    </media:group>`;
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

test("reads the public view count; leaves it out when the feed has none", () => {
  const xml = feed(
    entry("vNDPR3LKjn4", "Counted", "2026-11-03T12:30:00+00:00", channelId, media('<media:statistics views="42"/>')),
    entry("rQo5snk6TRM", "No statistics", "2026-11-01T12:30:00+00:00", channelId, media("")),
    entry("cMrS4vq7E1I", "No media block", "2026-10-26T12:30:00+00:00"),
    entry("HP9jcOGFwqY", "Malformed count", "2026-10-19T12:30:00+00:00", channelId, media('<media:statistics views="many"/>'))
  );
  const [counted, noStatistics, noMedia, malformed] = parseYouTubeFeed(xml, channelId);
  assert.deepEqual(counted, { id: "vNDPR3LKjn4", title: "Counted", published: "2026-11-03T12:30:00.000Z", views: 42 });
  for (const video of [noStatistics, noMedia, malformed]) assert.equal("views" in video, false, video.title);
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

test("refreshes the view counts of known uploads and keeps the last count of archived ones", () => {
  const current = [
    { id: "rQo5snk6TRM", title: "Rise Above the Impossible", published: "2026-11-01T00:00:00.000Z", views: 10 },
    { id: "z7PeNsdItyY", title: "Archived", published: "2024-08-15T00:00:00.000Z", views: 900 }
  ];
  const incoming = [{ id: "rQo5snk6TRM", title: "Rise Above the Impossible", published: "2026-11-01T00:00:00.000Z", views: 25 }];
  const { videos } = mergeYouTubeVideos(current, incoming);
  assert.deepEqual(videos.map((v) => v.views), [25, 900]);
});
