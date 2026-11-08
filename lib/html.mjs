// The site's one HTML-escape helper, for the markup built as strings (the pages composed in code, the menus, the
// feeds, the Events list). Plain JavaScript with no imports, so plain node (the scripts and unit tests), Next and
// the forms Worker (through lib/events.mjs) all share it.

/** Escapes text for HTML content and double-quoted attributes: &, <, > and " (every attribute built here is double-quoted). */
export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
