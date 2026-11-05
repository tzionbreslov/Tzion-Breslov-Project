import { notFound } from "next/navigation";
import { allSlugs, resolveRoute } from "@/lib/content";
import { SiteBody } from "@/components/site-document";

export const dynamicParams = false;

export function generateStaticParams() {
  return allSlugs().map((slug) => ({ slug }));
}

export default async function Page({ params }: PageProps<"/[[...slug]]">) {
  const { slug } = await params;
  const route = resolveRoute(slug);
  if (!route) notFound();
  if (route.kind === "redirect") return null;
  return <SiteBody page={route.page} />;
}
