import { notFound } from "next/navigation";
import { allSlugs, resolveRoute, routeIndex } from "@/lib/content";
import { RedirectDocument, SiteDocument } from "@/components/site-document";

export const dynamicParams = false;

export function generateStaticParams() {
  return allSlugs().map((slug) => ({ slug }));
}

export default async function RootLayout({ children, params }: LayoutProps<"/[[...slug]]">) {
  const { slug } = await params;
  const route = resolveRoute(slug);
  if (!route) notFound();
  if (route.kind === "redirect") return <RedirectDocument to={route.to} site={routeIndex().site} />;
  return <SiteDocument page={route.page}>{children}</SiteDocument>;
}
