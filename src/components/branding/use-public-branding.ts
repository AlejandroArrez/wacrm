"use client";

import { useEffect, useState } from "react";
import {
  brandingFromRow,
  DEFAULT_BRANDING,
  type Branding,
} from "@/lib/branding/branding";

/**
 * Branding for screens before sign-in (login, signup, forgot password),
 * from the public /api/branding endpoint. Starts with the defaults and
 * keeps them on any error.
 */
export function usePublicBranding(): { branding: Branding; loaded: boolean } {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Partial<Branding> | null) => {
        if (cancelled || !data) return;
        setBranding(
          brandingFromRow({
            brand_name: data.name,
            brand_logo_url: data.logoUrl,
            brand_logo_dark_url: data.logoDarkUrl,
            brand_icon_url: data.iconUrl,
            brand_icon_dark_url: data.iconDarkUrl,
          }),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { branding, loaded };
}
