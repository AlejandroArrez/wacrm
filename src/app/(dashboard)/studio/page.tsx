"use client";

import { useTranslations } from "next-intl";

/**
 * Content generator: ads, reels and carousels in the brand's styles,
 * with "Copy Mágico" answered by Claude through /api/studio/copy.
 * Hidden from advisors (see ADVISOR_HIDDEN_ROUTES); the page itself
 * is served by /api/studio/app, which checks the role again.
 */
export default function StudioPage() {
  const t = useTranslations("Studio");
  return (
    // Cancel the shell's padding so the generator uses the whole area.
    <div className="-m-4 h-[calc(100%+2rem)] min-h-[640px] sm:-m-6 sm:h-[calc(100%+3rem)]">
      <iframe
        src="/api/studio/app"
        title={t("title")}
        className="h-full w-full border-0 bg-white"
      />
    </div>
  );
}
