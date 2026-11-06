import { createElement, type ReactNode } from "react";
import { readShared, type Attrs, type HeadItem, type PageContent, type ScriptItem } from "@/lib/content";
import { expandTokens } from "@/lib/youtube-feed";
import { rebaseCss, rebaseHtml, withBase } from "@/lib/base-path";
import { SITE_URL, toSiteUrl } from "@/lib/site-url";
import { Enhancers } from "@/components/enhancers";
import "@/app/enhancements.css";

/**
 * Renders a WordPress-imported page as a full HTML document. The markup,
 * stylesheets and scripts are the original site's; React owns only the
 * document shell and the interactive islands (see components/enhancers).
 */

const ATTR_NAMES: Record<string, string> = {
  class: "className",
  crossorigin: "crossOrigin",
  "http-equiv": "httpEquiv",
  fetchpriority: "fetchPriority",
  referrerpolicy: "referrerPolicy",
  hreflang: "hrefLang",
  nomodule: "noModule"
};
const BOOLEAN_ATTRS = new Set(["defer", "async", "nomodule"]);

function props(attrs: Attrs, key: string) {
  const out: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(attrs)) {
    out[ATTR_NAMES[name] ?? name] = BOOLEAN_ATTRS.has(name) ? true : name === "href" || name === "src" ? withBase(toSiteUrl(value)) : toSiteUrl(value);
  }
  return out;
}

function script(item: ScriptItem, key: string) {
  const p = props(item.attrs, key);
  if (item.ref) p.dangerouslySetInnerHTML = { __html: readShared(item.ref) };
  return createElement("script", p);
}

function headItem(item: HeadItem, i: number) {
  const key = `h${i}`;
  switch (item.t) {
    case "title":
      return <title key={key}>{item.text}</title>;
    case "meta":
      return createElement("meta", props(item.attrs, key));
    case "link":
      return createElement("link", props(item.attrs, key));
    case "style":
      return <style key={key} id={item.id ?? undefined} dangerouslySetInnerHTML={{ __html: rebaseCss(readShared(item.ref)) }} />;
    case "jsonld":
      return <script key={key} type="application/ld+json" className="yoast-schema-graph" dangerouslySetInnerHTML={{ __html: toSiteUrl(item.json) }} />;
    case "script":
      return script(item, key);
  }
}

export function SiteDocument({ page, children }: { page: PageContent; children: ReactNode }) {
  const { lang, ...htmlAttrs } = page.htmlAttrs;
  return (
    <html lang={lang} {...htmlAttrs} suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {page.head.map(headItem)}
      </head>
      <body className={page.bodyClass} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

export function SiteBody({ page }: { page: PageContent }) {
  const html = [
    page.skipLinks && readShared(page.skipLinks),
    page.header && readShared(page.header),
    expandTokens(page.main),
    page.footer && readShared(page.footer),
    page.footerExtra
  ].filter(Boolean).join("");
  const rebased = rebaseHtml(html);
  return (
    <>
      <div className={page.siteContainerClass} dangerouslySetInnerHTML={{ __html: rebased }} suppressHydrationWarning />
      {page.bodyScripts.map((item, i) => script(item, `b${i}`))}
      <Enhancers islands={page.islands} />
    </>
  );
}

export function RedirectDocument({ to: target }: { to: string }) {
  const to = withBase(target);
  return (
    <html lang="en-US">
      <head>
        <meta charSet="UTF-8" />
        <title>Redirecting…</title>
        <meta httpEquiv="refresh" content={`0; url=${to}`} />
        <link rel="canonical" href={`${SITE_URL}${target}`} />
        <meta name="robots" content="noindex" />
      </head>
      <body>
        <p>
          This page has moved to <a href={to}>{to}</a>.
        </p>
      </body>
    </html>
  );
}
