// Preloaded by scripts/instagram-sync.test.mjs (`node --import`): replaces
// fetch with a fake Graph API + image CDN so the real sync script runs
// end-to-end with no network. MOCK_GRAPH selects the scenario.
import sharp from "sharp";

const scenario = process.env.MOCK_GRAPH ?? "ok";
const png = await sharp({ create: { width: 1440, height: 1800, channels: 3, background: { r: 30, g: 97, b: 161 } } }).png().toBuffer();
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const page1 = {
  data: [
    { id: "17900000000000001", media_type: "IMAGE", media_url: "https://cdn.example/1.jpg", permalink: "https://www.instagram.com/p/AAA111/", timestamp: "2026-11-01T10:00:00+0000", caption: "First post", alt_text: "Rabbi teaching" },
    { id: "17900000000000002", media_type: "CAROUSEL_ALBUM", permalink: "https://www.instagram.com/p/BBB222/", timestamp: "2026-10-28T10:00:00+0000", caption: "Album",
      children: { data: [
        { id: "17900000000000021", media_type: "IMAGE", media_url: "https://cdn.example/21.jpg" },
        { id: "17900000000000022", media_type: "VIDEO", thumbnail_url: "https://cdn.example/22.jpg" }
      ] } }
  ],
  paging: { next: "https://graph.facebook.com/v27.0/17841400000000000/media?after=CURSOR" }
};
const page2 = {
  data: [
    { id: "17900000000000003", media_type: "VIDEO", thumbnail_url: "https://cdn.example/3.jpg", permalink: "https://www.instagram.com/reel/CCC333/", timestamp: "2026-10-20T10:00:00+0000" },
    { id: "17900000000000004", media_type: "IMAGE", media_url: "https://cdn.example/4.jpg", permalink: "https://evil.example/p/x/", timestamp: "2026-10-10T10:00:00+0000" }
  ]
};

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === "cdn.example") return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  if (!url.hostname.startsWith("graph.")) throw new Error(`unexpected fetch ${url.hostname}`);
  if (!url.searchParams.get("access_token")) return json(400, { error: { code: 100, message: "missing token" } });
  if (scenario === "token") return json(400, { error: { type: "OAuthException", code: 190, message: "Error validating access token" } });
  if (scenario === "outage") return json(503, { error: { code: 2, message: "Service temporarily unavailable" } });
  if (scenario === "malformed") return json(200, { nope: true });
  return json(200, url.searchParams.get("after") ? page2 : page1);
};
