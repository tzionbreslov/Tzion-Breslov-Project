export type NavItem = {
  key: string;
  href?: string;
  pageId?: number;
  type: "post_type" | "custom";
  target?: "_blank";
  desktop?: { id: number | string; label: string };
  mobile?: { id: number | string; label: string };
  footer?: { label: string };
  children?: NavItem[];
};

export const ORIGINAL_NAV: NavItem[];
export const NAV: NavItem[];
export function renderNavigation(html: string, currentPath: string, items?: NavItem[]): string;
export function rewriteLinks(html: string): string;
