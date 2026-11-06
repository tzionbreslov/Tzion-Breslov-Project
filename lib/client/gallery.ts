import { openDialog } from "@/lib/client/dialog";

/**
 * Gallery page (lib/pages/gallery.ts): a click on a photo opens it in the
 * on-page viewer (lib/client/dialog.ts) — the photo whole, its caption (the
 * alt text) and "3 of 7" — with Previous / Next buttons that wrap around, the
 * arrow keys and a swipe (40px, like lib/client/instagram.ts). Photos
 * crossfade (app/gallery.css; at once with reduced motion). Without JS, or on
 * a ctrl/middle click, every photo is a link to its image file.
 *
 * Everything comes from the page: each photo's URL from its link (already
 * carrying the base path), its size and alt text from its image, the labels
 * from the gallery's data attributes (content/copy/en.json).
 */

type Photo = { link: HTMLAnchorElement; src: string; width: number; height: number; alt: string };
type Labels = { label: string; previous: string; next: string; close: string; counter: string };

const SWIPE_PX = 40;
/** How long the photo that leaves takes to fade out (the .3s opacity transition in app/gallery.css). */
const FADE_MS = 300;

const isPlainClick = (event: MouseEvent) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
const PREVIOUS = icon("M15 5l-7 7 7 7");
const NEXT = icon("M9 5l7 7-7 7");
const CLOSE = icon("M6 6l12 12M18 6 6 18");

let viewers = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function iconButton(className: string, label: string, svg: string) {
  const button = el("button", className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.innerHTML = svg;
  return button;
}

function readPhotos(root: HTMLElement): Photo[] {
  return [...root.querySelectorAll<HTMLAnchorElement>("a.tz-gallery__item")].map((link) => {
    const img = link.querySelector("img");
    return {
      link,
      src: link.getAttribute("href") ?? "",
      width: Number(img?.getAttribute("width")) || 0,
      height: Number(img?.getAttribute("height")) || 0,
      alt: img?.getAttribute("alt") ?? ""
    };
  });
}

function openViewer(photos: Photo[], start: number, labels: Labels) {
  const body = el("div", "tz-gallery-viewer__body");
  const close = iconButton("tz-dialog__close", labels.close, CLOSE);
  const stage = el("div", "tz-gallery-viewer__stage");
  const bar = el("div", "tz-gallery-viewer__bar");
  const previous = iconButton("tz-gallery-viewer__nav", labels.previous, PREVIOUS);
  const next = iconButton("tz-gallery-viewer__nav", labels.next, NEXT);
  // Read out whenever the photo changes, and as the dialog's description when it opens.
  const text = el("p", "tz-gallery-viewer__text");
  text.id = `tz-gallery-viewer-text-${++viewers}`;
  text.setAttribute("aria-live", "polite");
  text.setAttribute("aria-atomic", "true");
  const caption = el("span", "tz-gallery-viewer__caption");
  const counter = el("span", "tz-gallery-viewer__counter");
  text.append(caption, counter);
  bar.append(previous, text, next);
  // Close comes first, so it gets the focus when the viewer opens.
  body.append(close, stage, bar);

  let index = start;
  let current: HTMLImageElement | null = null;
  const show = (to: number) => {
    index = (to + photos.length) % photos.length;
    const photo = photos[index];
    const img = el("img", "tz-gallery-viewer__img is-current");
    img.src = photo.src;
    if (photo.width && photo.height) {
      img.width = photo.width;
      img.height = photo.height;
    }
    img.alt = photo.alt;
    img.decoding = "async";
    // A mouse drag would otherwise pick the image up instead of swiping.
    img.draggable = false;
    caption.textContent = photo.alt;
    counter.textContent = labels.counter.replace("{n}", String(index + 1)).replace("{total}", String(photos.length));
    // The new photo fades in on top (its CSS @starting-style) while the old one fades out, then leaves.
    const old = current;
    current = img;
    stage.append(img);
    if (old) {
      old.classList.remove("is-current");
      if (reducedMotion()) {
        old.remove();
      } else {
        // Once its fade has run (it can start a frame or two late); the timer only covers a fade that never runs.
        old.addEventListener("transitionend", () => old.remove(), { once: true });
        window.setTimeout(() => old.remove(), FADE_MS + 200);
      }
    }
    // The neighbours load in the background, so the next swipe has its photo ready.
    for (const step of [1, -1]) new Image().src = photos[(index + step + photos.length) % photos.length].src;
  };
  show(start);

  const onKey = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    show(index + (event.key === "ArrowRight" ? 1 : -1));
  };

  let swipeFrom: number | null = null;
  stage.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    swipeFrom = event.clientX;
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointerup", (event) => {
    if (swipeFrom === null) return;
    const dx = event.clientX - swipeFrom;
    swipeFrom = null;
    if (Math.abs(dx) > SWIPE_PX) show(index + (dx < 0 ? 1 : -1));
  });
  stage.addEventListener("pointercancel", () => { swipeFrom = null; });
  previous.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));

  document.addEventListener("keydown", onKey);
  const dialog = openDialog({
    label: labels.label,
    content: body,
    opener: photos[start].link,
    className: "tz-gallery-viewer",
    onClose: () => document.removeEventListener("keydown", onKey)
  });
  body.parentElement?.setAttribute("aria-describedby", text.id);
  close.addEventListener("click", () => dialog.close());
  return dialog;
}

function enhance(root: HTMLElement) {
  const { label = "", previousLabel = "", nextLabel = "", closeLabel = "", counter = "{n} / {total}" } = root.dataset;
  const labels: Labels = { label, previous: previousLabel, next: nextLabel, close: closeLabel, counter };
  const links = [...root.querySelectorAll<HTMLAnchorElement>("a.tz-gallery__item")];
  let viewer: { close(): void } | null = null;

  const onClick = (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.tz-gallery__item");
    if (!link || !isPlainClick(event)) return;
    const photos = readPhotos(root);
    const start = photos.findIndex((photo) => photo.link === link);
    if (start < 0) return;
    event.preventDefault();
    viewer = openViewer(photos, start, labels);
  };

  links.forEach((link) => link.setAttribute("aria-haspopup", "dialog"));
  root.addEventListener("click", onClick);
  root.dataset.tzGallery = "ready";
  return () => {
    root.removeEventListener("click", onClick);
    links.forEach((link) => link.removeAttribute("aria-haspopup"));
    viewer?.close();
    root.dataset.tzGallery = "";
  };
}

export function enhanceGallery(root: ParentNode = document): () => void {
  const cleanups = [...root.querySelectorAll<HTMLElement>("[data-tz-gallery]")].map(enhance);
  return () => cleanups.forEach((fn) => fn());
}
