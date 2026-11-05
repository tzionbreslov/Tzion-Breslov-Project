/**
 * Spectra post grids paginated through admin-ajax on WordPress, each grid
 * independently. Here every page of the listing is pre-rendered
 * (/resources/page/N/), so we fetch that page and swap in only the clicked
 * grid — same behaviour, no server.
 */

const BLOCK_CLASS = /\buagb-block-[a-z0-9]+\b/;

export function enhancePostGrids(root: Document = document) {
  const onClick = async (event: MouseEvent) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("[data-tz-post-grid] .uagb-post-pagination-wrap a");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const grid = link.closest<HTMLElement>("[data-tz-post-grid]");
    const blockClass = grid?.className.match(BLOCK_CLASS)?.[0];
    if (!grid || !blockClass) return;
    event.preventDefault();
    grid.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(link.href, { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const next = doc.querySelector(`.uagb-post-grid.${blockClass}`);
      if (!next) throw new Error("grid missing");
      grid.innerHTML = next.innerHTML;
      grid.querySelector<HTMLElement>("article a, a")?.focus({ preventScroll: true });
    } catch {
      window.location.href = link.href;
    } finally {
      grid.removeAttribute("aria-busy");
    }
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
