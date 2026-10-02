"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsPanelHead } from "./settings-panel-head";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import {
  BRAND_CREDIT,
  DEFAULT_BRAND_NAME,
  pickBrandImage,
  type Branding,
} from "@/lib/branding/branding";

const BUCKET = "branding";
/** Bucket cap (migration 046). */
const MAX_BYTES = 2 * 1024 * 1024;
const NAME_MAX = 40;
const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

type Slot = "logoUrl" | "logoDarkUrl" | "iconUrl" | "iconDarkUrl";

const SLOT_COLUMN: Record<Slot, string> = {
  logoUrl: "brand_logo_url",
  logoDarkUrl: "brand_logo_dark_url",
  iconUrl: "brand_icon_url",
  iconDarkUrl: "brand_icon_dark_url",
};

/** Fixed preview backgrounds, independent of the viewer's own theme. */
const PREVIEW_BG = { light: "#ffffff", dark: "#0f172a" } as const;
const PREVIEW_CREDIT = { light: "#64748b", dark: "#94a3b8" } as const;

export function BrandingSettings() {
  const t = useTranslations("Branding");
  const { account, refreshProfile } = useAuth();
  const canEdit = useCan("edit-settings");
  const supabase = useMemo(() => createClient(), []);

  const [draft, setDraft] = useState<Branding | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<Slot | null>(null);
  const inputs = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});

  // Seed the form from the account once it loads.
  useEffect(() => {
    if (!account || draft) return;
    setDraft(account.branding);
    setNameInput(
      account.branding.name === DEFAULT_BRAND_NAME ? "" : account.branding.name,
    );
  }, [account, draft]);

  if (!account || !draft) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const preview: Branding = {
    ...draft,
    name: nameInput.trim() || DEFAULT_BRAND_NAME,
  };

  const upload = async (slot: Slot, file: File | undefined) => {
    if (!file) return;
    try {
      if (!ACCEPT.split(",").includes(file.type)) {
        toast.error(t("invalidType"));
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error(t("tooBig"));
        return;
      }
      setUploading(slot);
      const { publicUrl } = await uploadAccountMedia(BUCKET, file);
      setDraft((d) => (d ? { ...d, [slot]: publicUrl } : d));
    } catch {
      toast.error(t("uploadFailed"));
    } finally {
      setUploading(null);
      const el = inputs.current[slot];
      if (el) el.value = "";
    }
  };

  const save = async () => {
    const name = nameInput.trim();
    if (name.length > NAME_MAX) {
      toast.error(t("nameTooLong", { max: NAME_MAX }));
      return;
    }
    setSaving(true);
    try {
      const row: Record<string, string | null> = { brand_name: name || null };
      (Object.keys(SLOT_COLUMN) as Slot[]).forEach((slot) => {
        row[SLOT_COLUMN[slot]] = draft[slot];
      });
      const { error } = await supabase.from("accounts").update(row).eq("id", account.id);
      if (error) {
        toast.error(t("saveFailed"));
        return;
      }
      // Browser tab title + login page are cached server-side; bust it.
      await fetch("/api/branding/refresh", { method: "POST" }).catch(() => {});
      await refreshProfile();
      toast.success(t("saved"));
    } finally {
      setSaving(false);
    }
  };

  const slots: { slot: Slot; label: string; help: string; wide: boolean }[] = [
    { slot: "logoUrl", label: t("logoLabel"), help: t("logoHelp"), wide: true },
    { slot: "logoDarkUrl", label: t("logoDarkLabel"), help: t("logoDarkHelp"), wide: true },
    { slot: "iconUrl", label: t("iconLabel"), help: t("iconHelp"), wide: false },
    { slot: "iconDarkUrl", label: t("iconDarkLabel"), help: t("iconDarkHelp"), wide: false },
  ];

  return (
    <div>
      <SettingsPanelHead title={t("title")} description={t("description")} />
      {!canEdit && (
        <p className="mb-4 text-xs text-muted-foreground">{t("readOnly")}</p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div>
            <label htmlFor="brand-name" className="mb-1 block text-xs text-muted-foreground">
              {t("nameLabel")}
            </label>
            <Input
              id="brand-name"
              value={nameInput}
              maxLength={NAME_MAX}
              disabled={!canEdit}
              placeholder={DEFAULT_BRAND_NAME}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t("nameHelp")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {slots.map(({ slot, label, help, wide }) => {
              const url = draft[slot];
              const dark = slot.endsWith("DarkUrl");
              return (
                <div key={slot} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="mb-2 text-[11px] text-muted-foreground">{help}</p>
                  <div
                    className="mb-2 flex h-20 items-center justify-center rounded-md border border-border"
                    style={{ background: dark ? PREVIEW_BG.dark : PREVIEW_BG.light }}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt=""
                        className={wide ? "h-8 max-w-[90%] object-contain" : "h-12 w-12 object-contain"}
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <input
                        ref={(el) => {
                          inputs.current[slot] = el;
                        }}
                        type="file"
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => upload(slot, e.target.files?.[0])}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={uploading !== null}
                        onClick={() => inputs.current[slot]?.click()}
                      >
                        {uploading === slot ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="mr-1 h-3.5 w-3.5" />
                        )}
                        {url ? t("replace") : t("upload")}
                      </Button>
                      {url ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={t("remove")}
                          onClick={() => setDraft({ ...draft, [slot]: null })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving || uploading !== null}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t("save")}
              </Button>
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("preview")}</p>
          <div className="space-y-3">
            {(["light", "dark"] as const).map((mode) => {
              const logo = pickBrandImage(preview, "logo", mode);
              const icon = pickBrandImage(preview, "icon", mode);
              return (
                <div
                  key={mode}
                  className="flex items-stretch overflow-hidden rounded-lg border border-border"
                  style={{ background: PREVIEW_BG[mode] }}
                >
                  {/* Expanded sidebar header */}
                  <div className="flex h-16 flex-1 flex-col justify-center gap-0.5 px-4">
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo} alt="" className="h-7 w-auto max-w-[196px] object-contain object-left" />
                    ) : (
                      <span
                        className="truncate text-sm font-semibold"
                        style={{ color: mode === "dark" ? "#f1f5f9" : "#0f172a" }}
                      >
                        {preview.name}
                      </span>
                    )}
                    <span className="text-[10px] tracking-wide" style={{ color: PREVIEW_CREDIT[mode] }}>
                      {BRAND_CREDIT}
                    </span>
                  </div>
                  {/* Collapsed sidebar header */}
                  <div
                    className="flex w-16 items-center justify-center border-l"
                    style={{ borderColor: mode === "dark" ? "#1e293b" : "#e2e8f0" }}
                  >
                    {icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={icon} alt="" className="h-8 w-8 object-contain" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{t("previewNote")}</p>
        </div>
      </div>
    </div>
  );
}
