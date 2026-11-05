import { loadPage } from "@/lib/content";
import { SiteBody, SiteDocument } from "@/components/site-document";

// The WordPress 404 page, rendered for any unmatched URL (out/404.html).
export default function GlobalNotFound() {
  const page = loadPage("404");
  return (
    <SiteDocument page={page}>
      <SiteBody page={page} />
    </SiteDocument>
  );
}
