import { openDialog } from "@/lib/client/dialog";
import { filterVideos, sortVideos, type LibraryVideo, type VideoOrder } from "@/lib/video-library.mjs";

/**
 * Classes page (lib/pages/classes.ts): switches between the Videos and Shorts
 * tabs, sorts and searches the server-rendered cards in place, and plays a
 * video in the on-page player (lib/client/dialog.ts) with YouTube's
 * privacy-enhanced embed, loaded only on click. Without JS every card is a
 * link to the video on YouTube.
 */

type Kind = "video" | "short";
type Card = { video: LibraryVideo; node: HTMLElement };

const isPlainClick = (event: MouseEvent) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);

function readCards(grid: HTMLElement): Card[] {
  return [...grid.querySelectorAll<HTMLElement>(".tz-vl__card")].map((node) => {
    const { id = "", title = "", published = "", views } = node.dataset;
    // A card without data-views has no count (Number("") would make it 0).
    const video: LibraryVideo = { id, title, published, ...(views ? { views: Number(views) } : {}) };
    return { video, node };
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function playVideo(video: LibraryVideo, opener: HTMLElement, closeLabel: string) {
  const content = el("div", "tz-vl-player__body");
  const title = el("h2", "tz-vl-player__title");
  title.textContent = video.title;
  const close = el("button", "tz-dialog__close");
  close.type = "button";
  close.setAttribute("aria-label", closeLabel);
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const frame = el("div", "tz-vl-player__frame");
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&playsinline=1&rel=0`;
  iframe.title = video.title;
  iframe.allow = "autoplay; clipboard-write; encrypted-media; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  frame.append(iframe);
  content.append(title, close, frame);

  // The video stops the moment the player starts closing.
  const dialog = openDialog({ label: video.title, content, opener, className: "tz-vl-player", onClose: () => iframe.remove() });
  close.addEventListener("click", () => dialog.close());
}

function enhance(root: HTMLElement) {
  const grids = new Map<Kind, HTMLElement>();
  const cards = new Map<Kind, Card[]>();
  for (const grid of root.querySelectorAll<HTMLElement>(".tz-vl__grid")) {
    const kind = grid.dataset.kind as Kind;
    grids.set(kind, grid);
    cards.set(kind, readCards(grid));
  }
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".tz-vl__tabs button")];
  const orders = [...root.querySelectorAll<HTMLButtonElement>(".tz-vl__sort button")];
  const sortGroup = root.querySelector<HTMLElement>(".tz-vl__sort");
  const searchOpen = root.querySelector<HTMLButtonElement>(".tz-vl__search-open");
  const searchField = root.querySelector<HTMLElement>(".tz-vl__search-field");
  const input = root.querySelector<HTMLInputElement>(".tz-vl__input");
  const empty = root.querySelector<HTMLElement>(".tz-vl__empty");
  const closeLabel = root.dataset.closeLabel ?? "";
  const noResults = root.dataset.noResults ?? "";
  if (!sortGroup || !searchOpen || !searchField || !input || !empty) return () => undefined;

  let kind: Kind = "video";
  let order: VideoOrder = "latest";

  // Re-lays the active tab's cards: sorted (Shorts by date only), non-matches hidden.
  const render = () => {
    const grid = grids.get(kind);
    const list = cards.get(kind) ?? [];
    if (!grid) return;
    const sorted = sortVideos(list.map((card) => card.video), kind === "short" ? "latest" : order);
    const matching = new Set(filterVideos(sorted, input.value).map((video) => video.id));
    const nodes = new Map(list.map((card) => [card.video.id, card.node]));
    for (const video of sorted) {
      const node = nodes.get(video.id)!;
      node.hidden = !matching.has(video.id);
      grid.append(node);
    }
    // The empty-search message is a live region that stays on the page: only its text changes, and only
    // when it differs, so a screen reader announces it once (not on every key typed while nothing matches).
    const message = matching.size > 0 ? "" : noResults;
    if (empty.textContent !== message) empty.textContent = message;
  };

  const setSearch = (open: boolean) => {
    searchField.hidden = !open;
    searchOpen.hidden = open;
    searchOpen.setAttribute("aria-expanded", String(open));
    root.classList.toggle("is-searching", open);
    if (open) input.focus();
  };
  const clearSearch = () => {
    input.value = "";
    setSearch(false);
    render();
    searchOpen.focus();
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const trigger = target.closest<HTMLAnchorElement>(".tz-vl__trigger");
    if (trigger) {
      const node = trigger.closest<HTMLElement>(".tz-vl__card");
      const card = [...cards.values()].flat().find((entry) => entry.node === node);
      if (card && isPlainClick(event)) {
        event.preventDefault();
        playVideo(card.video, trigger, closeLabel);
      }
      return;
    }
    const tab = target.closest<HTMLButtonElement>(".tz-vl__tabs button");
    if (tab && tab.dataset.kind !== kind) {
      kind = tab.dataset.kind as Kind;
      tabs.forEach((button) => button.setAttribute("aria-pressed", String(button === tab)));
      grids.forEach((grid, gridKind) => { grid.hidden = gridKind !== kind; });
      sortGroup.hidden = kind === "short";
      input.value = "";
      render();
      return;
    }
    const sort = target.closest<HTMLButtonElement>(".tz-vl__sort button");
    if (sort) {
      order = sort.dataset.order as VideoOrder;
      orders.forEach((button) => button.setAttribute("aria-pressed", String(button === sort)));
      render();
      return;
    }
    if (target.closest(".tz-vl__search-open")) setSearch(true);
    else if (target.closest(".tz-vl__search-clear")) clearSearch();
  };
  const onInput = () => render();
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    clearSearch();
  };

  root.addEventListener("click", onClick);
  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKey);
  root.dataset.tzVideoLibrary = "ready";
  return () => {
    root.removeEventListener("click", onClick);
    input.removeEventListener("input", onInput);
    input.removeEventListener("keydown", onKey);
    root.dataset.tzVideoLibrary = "";
  };
}

export function enhanceVideoLibrary(root: ParentNode = document): () => void {
  const cleanups = [...root.querySelectorAll<HTMLElement>("[data-tz-video-library]")].map(enhance);
  return () => cleanups.forEach((fn) => fn());
}
