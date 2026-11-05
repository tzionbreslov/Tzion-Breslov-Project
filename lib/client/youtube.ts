/**
 * Resources page YouTube grid: opens videos in an accessible lightbox (the
 * live plugin's lightbox behaviour) and pages through "Load More" locally.
 */

function openLightbox(videoId: string, title: string, opener: HTMLElement) {
  const overlay = document.createElement("div");
  overlay.className = "tz-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);

  const frameWrap = document.createElement("div");
  frameWrap.className = "tz-lightbox__frame";
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`;
  iframe.title = title;
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.allowFullscreen = true;
  frameWrap.append(iframe);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "tz-lightbox__close";
  close.setAttribute("aria-label", "Close video");
  close.textContent = "×";

  overlay.append(close, frameWrap);
  document.body.append(overlay);
  document.documentElement.classList.add("tz-lightbox-open");
  close.focus();

  const dismiss = () => {
    overlay.remove();
    document.documentElement.classList.remove("tz-lightbox-open");
    document.removeEventListener("keydown", onKey);
    opener.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") dismiss();
    if (event.key === "Tab") {
      event.preventDefault();
      close.focus();
    }
  };
  close.addEventListener("click", dismiss);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) dismiss(); });
  document.addEventListener("keydown", onKey);
}

export function enhanceYoutubeFeeds(root: ParentNode = document) {
  const feeds = [...root.querySelectorAll<HTMLElement>("[data-tz-youtube-feed]")];
  const handlers: Array<() => void> = [];
  for (const feed of feeds) {
    const perPage = Number(feed.dataset.num ?? 9);
    // The plugin sized thumbnails to whole-pixel 16:9 heights; match it
    // exactly (CSS aspect-ratio remains the no-JS fallback).
    const size = () => feed.querySelectorAll<HTMLElement>(".sby_video_thumbnail").forEach((thumb) => {
      // Drop aspect-ratio first: with a fixed height it would derive the width.
      thumb.style.aspectRatio = "auto";
      thumb.style.height = "";
      const width = thumb.getBoundingClientRect().width;
      thumb.style.height = `${Math.floor(width * 9 / 16)}px`;
      // Same thumbnail resolution choice as the plugin (by rendered width).
      const variant = width <= 120 ? "default" : width <= 320 ? "mqdefault" : width <= 480 ? "hqdefault" : "sddefault";
      const id = thumb.dataset.videoId;
      if (id) thumb.style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/${variant}.jpg")`;
    });
    size();
    const observer = new ResizeObserver(size);
    observer.observe(feed);
    handlers.push(() => observer.disconnect());
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const thumb = target.closest<HTMLAnchorElement>(".sby_video_thumbnail");
      if (thumb && !(event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) {
        event.preventDefault();
        openLightbox(thumb.dataset.videoId ?? "", thumb.dataset.videoTitle ?? "YouTube video", thumb);
        return;
      }
      const more = target.closest<HTMLButtonElement>(".sby_load_btn");
      if (more) {
        const hidden = [...feed.querySelectorAll<HTMLElement>(".sby_item.tz-more")].slice(0, perPage);
        hidden.forEach((item) => item.classList.remove("tz-more"));
        hidden[0]?.querySelector<HTMLElement>(".sby_video_thumbnail")?.focus();
        const status = feed.querySelector("[data-sby-feed-status]");
        if (status) status.textContent = `${hidden.length} more videos loaded`;
        if (!feed.querySelector(".sby_item.tz-more")) more.remove();
      }
    };
    feed.addEventListener("click", onClick);
    handlers.push(() => feed.removeEventListener("click", onClick));
  }
  return () => handlers.forEach((fn) => fn());
}
