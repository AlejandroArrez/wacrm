"use client";

import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BRAND_CREDIT,
  pickBrandImage,
  type Branding,
} from "@/lib/branding/branding";

/**
 * A brand image that follows the color mode. Both variants are in the
 * DOM and CSS (`.brand-img-light` / `.brand-img-dark` in globals.css,
 * keyed on `html[data-mode]`) shows one. Choosing the `src` in React
 * instead breaks on first paint: the server renders light, the boot
 * script flips the page to dark before hydration, and React keeps the
 * server's `src` — a navy logo on a navy sidebar.
 */
export function BrandImage({
  branding,
  kind,
  alt,
  className,
}: {
  branding: Branding;
  kind: "logo" | "icon";
  alt: string;
  className?: string;
}) {
  const light = pickBrandImage(branding, kind, "light");
  const dark = pickBrandImage(branding, kind, "dark");
  if (!light && !dark) return null;
  if (light === dark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={light!} alt={alt} className={className} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={light!} alt={alt} className={cn("brand-img-light", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dark!} alt={alt} className={cn("brand-img-dark", className)} />
    </>
  );
}

/**
 * The CRM's brand block: the account's logo with "By Strato" under it,
 * or — collapsed — just the square icon. Falls back to the default chat
 * glyph plus the brand name when no image was uploaded.
 */
export function BrandMark({
  branding,
  collapsed = false,
  className,
}: {
  branding: Branding;
  collapsed?: boolean;
  className?: string;
}) {
  const hasLogo = !!(branding.logoUrl || branding.logoDarkUrl);
  const hasIcon = !!(branding.iconUrl || branding.iconDarkUrl);

  if (collapsed) {
    return hasIcon ? (
      <span className={cn("flex h-8 w-8 items-center justify-center", className)}>
        <BrandImage
          branding={branding}
          kind="icon"
          alt={branding.name}
          className="h-8 w-8 object-contain"
        />
      </span>
    ) : (
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground",
          className,
        )}
        title={branding.name}
      >
        <MessageSquare className="h-4 w-4" />
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col justify-center gap-0.5", className)}>
      {hasLogo ? (
        <BrandImage
          branding={branding}
          kind="logo"
          alt={branding.name}
          className="h-7 w-auto max-w-[196px] object-contain object-left"
        />
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          {hasIcon ? (
            <BrandImage
              branding={branding}
              kind="icon"
              alt=""
              className="h-7 w-7 shrink-0 object-contain"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
            </div>
          )}
          <span className="truncate text-sm font-semibold text-foreground">
            {branding.name}
          </span>
        </div>
      )}
      <span className="pl-px text-[10px] leading-none tracking-wide text-muted-foreground">
        {BRAND_CREDIT}
      </span>
    </div>
  );
}
