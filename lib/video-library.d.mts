export type LibraryVideo = { id: string; title: string; published: string; views?: number };
export type VideoOrder = "latest" | "popular" | "oldest";

export function sortVideos(videos: LibraryVideo[], order: VideoOrder): LibraryVideo[];
export function filterVideos(videos: LibraryVideo[], query: string): LibraryVideo[];
export function formatMonthYear(iso: string): string;
