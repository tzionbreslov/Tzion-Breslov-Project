export type Route = { path: string; key: string };
export type RouteIndex = { site: string; routes: Route[]; redirects: Record<string, string> };

export const NEW_ROUTES: Route[];
export const REMOVED_PATHS: string[];
export const LINK_REWRITES: Record<string, string>;
export const REMOVED_SITEMAPS: string[];
export const TEMPLATE_KEYS: string[];
export const INSTAGRAM_ENABLED: boolean;
export function isRemovedPath(path: string, removed?: string[]): boolean;
export function siteRoutes(index: RouteIndex, opts?: { removed?: string[]; newRoutes?: Route[] }): RouteIndex;
