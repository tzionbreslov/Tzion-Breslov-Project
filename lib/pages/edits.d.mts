/** headingTag: "h1" makes the hero's heading the page's main heading (default "h2", as the Resources hero has it). */
export type HeroOptions = { image: string; heading: string; subheading?: string; headingTag?: "h1" | "h2" };

export function esc(s: string): string;
export function markerMissing(name: string): Error;
export function markerRepeated(name: string): Error;
export function replaceOnce(html: string, pattern: RegExp, replace: (...match: string[]) => string, name: string): string;
export function swapHero(hero: string, options: HeroOptions): string;
/** A head item as lib/content-files.ts types it (HeadItem): only what swapHead reads. */
export type HeadTag = { t: string; attrs?: Record<string, string> };
export function swapHead<T extends HeadTag>(head: T[], own: T[]): T[];
