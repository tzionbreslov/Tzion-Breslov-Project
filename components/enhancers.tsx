"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Island } from "@/lib/content";
import { enhanceForms } from "@/lib/client/forms";
import { enhanceSubscriptionConfirmation } from "@/lib/client/subscription-confirm";
import { enhanceYoutubeFeeds } from "@/lib/client/youtube";
import { enhancePostGrids } from "@/lib/client/post-grid";
import { enhanceInstagramFeeds } from "@/lib/client/instagram";
import { enhanceVideoLibrary } from "@/lib/client/video-library";
import { enhanceGallery } from "@/lib/client/gallery";
import { enhanceMenus } from "@/lib/client/menu";
import { DonateForm } from "@/components/donate-form";

const noop = () => () => undefined;

/**
 * Client behaviour for the imported WordPress markup. Everything else on the
 * page is the original HTML + the original theme scripts (jQuery, GSAP, Spectra).
 */
export function Enhancers({ islands }: { islands: Island[] }) {
  const donateHost = useSyncExternalStore(
    noop,
    () => (islands.includes("donate") ? document.querySelector<HTMLElement>('[data-tz-island="donate"]') : null),
    () => null
  );
  const confirmed = useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get("subscription") === "confirmed",
    () => false
  );
  const [noticeOpen, setNoticeOpen] = useState(true);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    cleanups.push(enhanceMenus(document));
    cleanups.push(enhanceSubscriptionConfirmation(document));
    if (islands.includes("signup") || islands.includes("contact")) cleanups.push(enhanceForms(document));
    if (islands.includes("youtube-feed")) cleanups.push(enhanceYoutubeFeeds(document));
    if (islands.includes("post-grid")) cleanups.push(enhancePostGrids(document));
    if (islands.includes("instagram-feed")) cleanups.push(enhanceInstagramFeeds(document));
    if (islands.includes("video-library")) cleanups.push(enhanceVideoLibrary(document));
    if (islands.includes("gallery")) cleanups.push(enhanceGallery(document));
    return () => cleanups.forEach((fn) => fn());
  }, [islands]);

  return (
    <>
      {donateHost && createPortal(<DonateForm />, donateHost)}
      {confirmed && noticeOpen && (
        <div className="tz-notice" role="status">
          <p>You&rsquo;ve joined the Tzion Breslov mailing list, welcome to the family!</p>
          <button type="button" aria-label="Dismiss" onClick={() => setNoticeOpen(false)}>×</button>
        </div>
      )}
    </>
  );
}
