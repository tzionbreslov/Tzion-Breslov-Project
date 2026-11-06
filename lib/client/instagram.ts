import type { InstagramClientData, InstagramClientPost } from "@/lib/instagram-feed";

/**
 * Instagram tab: opens a post in an in-site preview (photo or carousel + the
 * caption set for reading) whose button continues to instagram.com in a new
 * tab, and pages the grid with "Show more posts". Without JS every tile is
 * already a plain link to the post.
 */

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Caption → paragraphs; single newlines kept; #tags and @mentions styled. Text only, never HTML. */
function renderCaption(container: HTMLElement, caption: string) {
  const paragraphs = caption.trim().split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const p = el("p");
    paragraph.split("\n").forEach((line, i) => {
      if (i) p.append(el("br"));
      for (const part of line.split(/([#@][\p{L}\p{N}_.]+)/u)) {
        if (!part) continue;
        p.append(/^[#@][\p{L}\p{N}_]/u.test(part) ? el("span", "tz-igv__tag", part) : document.createTextNode(part));
      }
    });
    container.append(p);
  }
}

function openPreview(data: InstagramClientData, post: InstagramClientPost, opener: HTMLElement) {
  let slide = 0;
  const total = post.media.length;
  const isReel = post.type === "reel";
  const cta = isReel ? "Watch on Instagram" : "View on Instagram";

  const overlay = el("div", "tz-igv");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "tz-igv-title");
  overlay.setAttribute("aria-describedby", "tz-igv-caption");
  if (!reducedMotion()) overlay.classList.add("is-animated");

  const panel = el("div", "tz-igv__panel");
  const media = el("div", "tz-igv__media");
  const track = el("div", "tz-igv__track");
  const images = post.media.map((m, i) => {
    const img = el("img", `tz-igv__img${i === 0 ? " is-current" : ""}`);
    img.src = m.src;
    img.width = m.width;
    img.height = m.height;
    img.alt = m.alt || (total > 1 ? `Photo ${i + 1} of ${total}` : "");
    img.decoding = "async";
    if (i > 0) img.loading = "lazy";
    track.append(img);
    return img;
  });
  media.append(track);

  const count = el("p", "tz-igv__count");
  count.setAttribute("aria-live", "polite");
  const prev = el("button", "tz-igv__nav tz-igv__nav--prev");
  const next = el("button", "tz-igv__nav tz-igv__nav--next");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "Previous photo");
  next.setAttribute("aria-label", "Next photo");
  prev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  if (total > 1) media.append(prev, next, count);

  if (isReel) {
    const play = el("a", "tz-igv__play") as HTMLAnchorElement;
    play.href = post.permalink;
    play.target = "_blank";
    play.rel = "noopener";
    play.setAttribute("aria-label", "Watch this reel on Instagram (opens in a new tab)");
    play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    media.append(play);
  }

  const text = el("div", "tz-igv__text");
  const head = el("header", "tz-igv__head");
  const avatar = el("img", "tz-igv__avatar");
  avatar.src = data.avatar;
  avatar.alt = "";
  avatar.width = avatar.height = 44;
  const who = el("div", "tz-igv__who");
  const name = el("p", "tz-igv__name", data.name);
  name.id = "tz-igv-title";
  const time = el("time", "tz-igv__date", post.date);
  time.dateTime = post.timestamp;
  who.append(name, time);
  head.append(avatar, who);

  const caption = el("div", "tz-igv__caption");
  caption.id = "tz-igv-caption";
  caption.tabIndex = 0;
  if (post.caption.trim()) renderCaption(caption, post.caption);
  else caption.append(el("p", "tz-igv__nocaption", "No caption on this post."));

  const foot = el("footer", "tz-igv__foot");
  const link = el("a", "tz-igv__cta", cta) as HTMLAnchorElement;
  link.href = post.permalink;
  link.target = "_blank";
  link.rel = "noopener";
  link.setAttribute("aria-label", `${cta} (opens in a new tab)`);
  foot.append(link);
  text.append(head, caption, foot);

  const close = el("button", "tz-igv__close");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  panel.append(media, text, close);
  overlay.append(panel);
  document.body.append(overlay);
  document.documentElement.classList.add("tz-igv-open");

  const show = (index: number) => {
    slide = (index + total) % total;
    images.forEach((img, i) => img.classList.toggle("is-current", i === slide));
    count.textContent = `${slide + 1} of ${total}`;
  };
  if (total > 1) show(0);

  const dismiss = () => {
    overlay.remove();
    document.documentElement.classList.remove("tz-igv-open");
    document.removeEventListener("keydown", onKey);
    opener.focus();
  };
  const focusables = () => [...panel.querySelectorAll<HTMLElement>("a[href], button, [tabindex='0']")].filter((n) => n.offsetParent !== null);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") dismiss();
    else if (total > 1 && event.key === "ArrowLeft") show(slide - 1);
    else if (total > 1 && event.key === "ArrowRight") show(slide + 1);
    else if (event.key === "Tab") {
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };

  // Swipe between carousel photos.
  let startX: number | null = null;
  track.addEventListener("pointerdown", (e) => { startX = e.clientX; });
  track.addEventListener("pointerup", (e) => {
    if (startX === null || total < 2) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) show(slide + (dx < 0 ? 1 : -1));
  });

  prev.addEventListener("click", () => show(slide - 1));
  next.addEventListener("click", () => show(slide + 1));
  close.addEventListener("click", dismiss);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) dismiss(); });
  document.addEventListener("keydown", onKey);
  close.focus();
}

export function enhanceInstagramFeeds(root: ParentNode = document) {
  const cleanups: Array<() => void> = [];
  for (const feed of root.querySelectorAll<HTMLElement>("[data-tz-instagram-feed]")) {
    const raw = feed.querySelector(".tz-ig__data")?.textContent;
    if (!raw) continue;
    const data = JSON.parse(raw) as InstagramClientData;
    const perPage = Number(feed.dataset.perPage ?? 9);

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const tile = target.closest<HTMLAnchorElement>(".tz-ig__tile");
      if (tile && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) {
        const post = data.posts[Number(tile.dataset.igIndex)];
        if (post) {
          event.preventDefault();
          openPreview(data, post, tile);
        }
        return;
      }
      const load = target.closest<HTMLButtonElement>(".tz-ig__load");
      if (load) {
        const hidden = [...feed.querySelectorAll<HTMLElement>(".tz-ig__item.tz-more")].slice(0, perPage);
        hidden.forEach((item) => item.classList.remove("tz-more"));
        hidden[0]?.querySelector<HTMLElement>(".tz-ig__tile")?.focus();
        const status = feed.querySelector(".tz-ig__status");
        if (status) status.textContent = `${hidden.length} more posts shown`;
        if (!feed.querySelector(".tz-ig__item.tz-more")) load.remove();
      }
    };
    feed.addEventListener("click", onClick);
    cleanups.push(() => feed.removeEventListener("click", onClick));
  }
  return () => cleanups.forEach((fn) => fn());
}
