/**
 * The menus' dropdowns (rendered by lib/navigation.mjs as li.tz-menu-parent >
 * button.tz-submenu-toggle + ul.tz-sub-menu), in the desktop and the mobile
 * menu. The button opens and closes its panel by mouse, touch and keyboard; in
 * the desktop menu a mouse also opens it by hovering, and leaving closes it
 * unless the panel was pinned by a mouse click or by focus moving into it.
 * Escape, a click or tap outside, or focus moving out closes it. Once this runs
 * it owns the open state (aria-expanded), taking over whatever was showing;
 * before that, or without JS, app/navigation.css opens the desktop panel on
 * :hover and :focus-within.
 */

const PARENT = ".tz-menu-parent";
const TOGGLE = ":scope > .tz-submenu-toggle";
const DESKTOP_MENU = ".nav-primary";

export function enhanceMenus(root: Document = document): () => void {
  const parents = [...root.querySelectorAll<HTMLElement>(PARENT)].filter((parent) => parent.querySelector(TOGGLE));
  const toggleOf = (parent: HTMLElement) => parent.querySelector<HTMLButtonElement>(TOGGLE)!;
  const isOpen = (parent: HTMLElement) => toggleOf(parent).getAttribute("aria-expanded") === "true";
  // Opened by the mouse hovering it (not pinned by a click): leaving closes it again.
  const hovered = new WeakSet<HTMLElement>();
  const setOpen = (parent: HTMLElement, open: boolean) => {
    toggleOf(parent).setAttribute("aria-expanded", String(open));
    if (!open) hovered.delete(parent);
  };
  const removers: Array<() => void> = [];
  const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void) => {
    target.addEventListener(type, handler as EventListener);
    removers.push(() => target.removeEventListener(type, handler as EventListener));
  };

  for (const parent of parents) {
    listen<MouseEvent>(toggleOf(parent), "click", (event) => {
      // A mouse click on a panel the mouse just opened keeps it open (and pins it);
      // Enter/Space (a click with detail 0) always toggles.
      if (hovered.has(parent) && event.detail > 0) hovered.delete(parent);
      else setOpen(parent, !isOpen(parent));
    });
    listen<FocusEvent>(parent, "focusin", (event) => {
      // Focus inside the panel pins it, so the mouse leaving never hides the focused link.
      if (event.target !== toggleOf(parent)) hovered.delete(parent);
    });
    listen<FocusEvent>(parent, "focusout", (event) => {
      if (event.relatedTarget instanceof Node && !parent.contains(event.relatedTarget)) setOpen(parent, false);
    });
    if (parent.closest(DESKTOP_MENU)) {
      // Only a real mouse: a tap also sends pointerenter, and must toggle by its click instead.
      listen<PointerEvent>(parent, "pointerenter", (event) => {
        if (event.pointerType !== "mouse" || isOpen(parent)) return;
        setOpen(parent, true);
        hovered.add(parent);
      });
      listen<PointerEvent>(parent, "pointerleave", (event) => {
        if (event.pointerType === "mouse" && hovered.has(parent)) setOpen(parent, false);
      });
      // Until now CSS showed the panel on :hover / :focus-within; keep it open where it was showing.
      if (parent.matches(":focus-within")) setOpen(parent, true);
      else if (parent.matches(":hover")) {
        setOpen(parent, true);
        hovered.add(parent);
      }
    }
    parent.dataset.tzMenu = "ready";
  }

  listen<KeyboardEvent>(root, "keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const parent of parents) {
      if (!isOpen(parent)) continue;
      const focusInside = parent.contains(root.activeElement);
      setOpen(parent, false);
      if (focusInside) toggleOf(parent).focus();
    }
  });
  listen<PointerEvent>(root, "pointerdown", (event) => {
    for (const parent of parents) {
      if (isOpen(parent) && !parent.contains(event.target as Node)) setOpen(parent, false);
    }
  });

  return () => {
    removers.forEach((remove) => remove());
    for (const parent of parents) {
      setOpen(parent, false);
      delete parent.dataset.tzMenu;
    }
  };
}
