export type HeroOptions = { image: string; heading: string; subheading?: string };

export function esc(s: string): string;
export function markerMissing(name: string): Error;
export function markerRepeated(name: string): Error;
export function replaceOnce(html: string, pattern: RegExp, replace: (...match: string[]) => string, name: string): string;
export function swapHero(hero: string, options: HeroOptions): string;
