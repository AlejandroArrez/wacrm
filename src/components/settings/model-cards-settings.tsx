"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { SettingsPanelHead } from "./settings-panel-head";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import {
  buildCardBody,
  cardButtons,
  floorsLabel,
  type ModelCard,
} from "@/lib/model-cards/format";

const BUCKET = "model-cards";
/** Meta's cap for image headers. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Bucket cap (migration 045). */
const PDF_MAX_BYTES = 16 * 1024 * 1024;
/** Longest side of the JPEG we upload — plenty for a phone screen. */
const IMAGE_MAX_SIDE = 1600;
const DESCRIPTION_MAX = 600;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

interface Draft {
  id?: string;
  slug: string;
  name: string;
  area_m2: string;
  bedrooms: string;
  bathrooms: string;
  terrace_m2: string;
  floors_text: string;
  description: string;
  image_url: string;
  brochure_url: string;
  brochure_filename: string;
  active: boolean;
  sort_order: string;
}

function emptyDraft(nextOrder: number): Draft {
  return {
    slug: "",
    name: "",
    area_m2: "",
    bedrooms: "",
    bathrooms: "",
    terrace_m2: "",
    floors_text: "",
    description: "",
    image_url: "",
    brochure_url: "",
    brochure_filename: "",
    active: true,
    sort_order: String(nextOrder),
  };
}

function toDraft(c: ModelCard): Draft {
  // PostgREST sends numerics as strings ("2.0"); show them as typed numbers.
  const s = (v: number | string | null) =>
    v == null || v === "" ? "" : String(Number(v));
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    area_m2: s(c.area_m2),
    bedrooms: s(c.bedrooms),
    bathrooms: s(c.bathrooms),
    terrace_m2: s(c.terrace_m2),
    floors_text: c.floors_text ?? "",
    description: c.description ?? "",
    image_url: c.image_url ?? "",
    brochure_url: c.brochure_url ?? "",
    brochure_filename: c.brochure_filename ?? "",
    active: c.active,
    sort_order: String(c.sort_order),
  };
}

/** "Atrium 2.1" → "atrium-2-1". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function numOrNull(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Re-encode any image to a JPEG no wider/taller than IMAGE_MAX_SIDE.
 * WhatsApp image headers accept only JPEG/PNG, and renders often come
 * as WebP — converting here means the admin can upload whatever they
 * have.
 */
async function toJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", 0.85),
  );
  const base = file.name.replace(/\.[^.]+$/, "") || "imagen";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

export function ModelCardsSettings() {
  const t = useTranslations("ModelCards");
  const { account } = useAuth();
  const canEdit = useCan("edit-settings");
  const supabase = useMemo(() => createClient(), []);

  const [cards, setCards] = useState<ModelCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"image" | "brochure" | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("model_cards")
      .select("*")
      .eq("account_id", account.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (!error) setCards((data ?? []) as ModelCard[]);
    setLoading(false);
  }, [account?.id, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    const next = cards.reduce((m, c) => Math.max(m, c.sort_order), 0) + 1;
    setSlugTouched(false);
    setDraft(emptyDraft(next));
  };
  const openEdit = (c: ModelCard) => {
    setSlugTouched(true);
    setDraft(toDraft(c));
  };

  const setName = (name: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      name,
      // Suggest the slug from the name until the admin edits it by hand.
      slug: !draft.id && !slugTouched ? slugify(name) : draft.slug,
    });
  };

  const upload = async (kind: "image" | "brochure", picked: File | undefined) => {
    if (!draft || !picked) return;
    try {
      setUploading(kind);
      let file = picked;
      if (kind === "image") {
        if (!file.type.startsWith("image/")) {
          toast.error(t("imageInvalid"));
          return;
        }
        file = await toJpeg(file);
        if (file.size > IMAGE_MAX_BYTES) {
          toast.error(t("imageTooBig"));
          return;
        }
      } else {
        if (file.type !== "application/pdf") {
          toast.error(t("brochureInvalid"));
          return;
        }
        if (file.size > PDF_MAX_BYTES) {
          toast.error(t("brochureTooBig"));
          return;
        }
      }
      const { publicUrl } = await uploadAccountMedia(BUCKET, file);
      setDraft((d) =>
        !d
          ? d
          : kind === "image"
            ? { ...d, image_url: publicUrl }
            : // Keep the original file name for the customer's download.
              { ...d, brochure_url: publicUrl, brochure_filename: picked.name.slice(0, 120) },
      );
    } catch {
      toast.error(t("uploadFailed"));
    } finally {
      setUploading(null);
      if (imageInput.current) imageInput.current.value = "";
      if (pdfInput.current) pdfInput.current.value = "";
    }
  };

  const save = async () => {
    if (!draft || !account?.id) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!SLUG_RE.test(draft.slug)) {
      toast.error(t("slugInvalid"));
      return;
    }
    const row = {
      account_id: account.id,
      slug: draft.slug,
      name,
      area_m2: numOrNull(draft.area_m2),
      bedrooms: numOrNull(draft.bedrooms),
      bathrooms: numOrNull(draft.bathrooms),
      terrace_m2: numOrNull(draft.terrace_m2),
      floors_text: draft.floors_text.trim() || null,
      description: draft.description.trim() || null,
      image_url: draft.image_url || null,
      brochure_url: draft.brochure_url || null,
      brochure_filename: draft.brochure_url ? draft.brochure_filename || null : null,
      active: draft.active,
      sort_order: numOrNull(draft.sort_order) ?? 0,
    };
    setSaving(true);
    try {
      const { error } = draft.id
        ? await supabase.from("model_cards").update(row).eq("id", draft.id)
        : await supabase.from("model_cards").insert(row);
      if (error) {
        toast.error(error.code === "23505" ? t("slugTaken") : t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: ModelCard) => {
    if (!window.confirm(t("deleteConfirm", { name: c.name }))) return;
    const { error } = await supabase.from("model_cards").delete().eq("id", c.id);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
    toast.success(t("deleted"));
    await load();
  };

  const toggleActive = async (c: ModelCard, active: boolean) => {
    const { error } = await supabase.from("model_cards").update({ active }).eq("id", c.id);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setCards((list) => list.map((x) => (x.id === c.id ? { ...x, active } : x)));
  };

  const previewCard = draft
    ? {
        slug: draft.slug || "modelo",
        name: draft.name || t("namePlaceholder"),
        area_m2: numOrNull(draft.area_m2),
        bedrooms: numOrNull(draft.bedrooms),
        bathrooms: numOrNull(draft.bathrooms),
        terrace_m2: numOrNull(draft.terrace_m2),
        floors_text: draft.floors_text,
        description: draft.description,
        brochure_url: draft.brochure_url || null,
      }
    : null;

  return (
    <div>
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
        action={
          canEdit ? (
            <Button onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" />
              {t("newCard")}
            </Button>
          ) : null
        }
      />

      {!canEdit && (
        <p className="mb-4 text-xs text-muted-foreground">{t("readOnly")}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : cards.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              {c.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.image_url}
                  alt=""
                  className="h-12 w-16 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-muted">
                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {c.name}
                  {c.area_m2 != null ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {Number(c.area_m2)} m²
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[floorsLabel(c.floors_text), c.brochure_url ? t("hasBrochure") : t("noBrochure")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={c.active}
                  disabled={!canEdit}
                  onCheckedChange={(v) => toggleActive(c, v)}
                  aria-label={t("activeLabel")}
                />
                {canEdit && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(c)}
                      aria-label={t("edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(c)}
                      aria-label={t("delete")}
                      className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("editTitle") : t("newTitle")}</DialogTitle>
          </DialogHeader>
          {draft && previewCard && (
            <div className="grid max-h-[70vh] gap-5 overflow-y-auto md:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("nameLabel")}>
                    <Input
                      value={draft.name}
                      maxLength={60}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("namePlaceholder")}
                    />
                  </Field>
                  <Field label={t("slugLabel")} help={t("slugHelp")}>
                    <Input
                      value={draft.slug}
                      maxLength={40}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setDraft({ ...draft, slug: e.target.value.toLowerCase() });
                      }}
                      placeholder="atrium"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label={t("areaLabel")}>
                    <Input
                      inputMode="decimal"
                      value={draft.area_m2}
                      onChange={(e) => setDraft({ ...draft, area_m2: e.target.value })}
                      placeholder="74.44"
                    />
                  </Field>
                  <Field label={t("bedroomsLabel")}>
                    <Input
                      inputMode="numeric"
                      value={draft.bedrooms}
                      onChange={(e) => setDraft({ ...draft, bedrooms: e.target.value })}
                    />
                  </Field>
                  <Field label={t("bathroomsLabel")}>
                    <Input
                      inputMode="decimal"
                      value={draft.bathrooms}
                      onChange={(e) => setDraft({ ...draft, bathrooms: e.target.value })}
                    />
                  </Field>
                  <Field label={t("terraceLabel")}>
                    <Input
                      inputMode="decimal"
                      value={draft.terrace_m2}
                      onChange={(e) => setDraft({ ...draft, terrace_m2: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t("floorsLabel")} help={t("floorsHelp")}>
                  <Input
                    value={draft.floors_text}
                    maxLength={60}
                    onChange={(e) => setDraft({ ...draft, floors_text: e.target.value })}
                    placeholder={t("floorsPlaceholder")}
                  />
                </Field>
                <Field
                  label={t("descriptionLabel")}
                  help={t("descriptionCount", {
                    count: draft.description.length,
                    max: DESCRIPTION_MAX,
                  })}
                >
                  <Textarea
                    value={draft.description}
                    maxLength={DESCRIPTION_MAX}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="min-h-24"
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("imageLabel")} help={t("imageHelp")}>
                    <input
                      ref={imageInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => upload("image", e.target.files?.[0])}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={uploading !== null}
                      onClick={() => imageInput.current?.click()}
                    >
                      {uploading === "image" ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-1 h-4 w-4" />
                      )}
                      {draft.image_url ? t("imageReplace") : t("imageUpload")}
                    </Button>
                  </Field>
                  <Field label={t("brochureLabel")} help={t("brochureHelp")}>
                    <input
                      ref={pdfInput}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => upload("brochure", e.target.files?.[0])}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        disabled={uploading !== null}
                        onClick={() => pdfInput.current?.click()}
                      >
                        {uploading === "brochure" ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="mr-1 h-4 w-4" />
                        )}
                        {draft.brochure_url ? t("brochureReplace") : t("brochureUpload")}
                      </Button>
                      {draft.brochure_url ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setDraft({ ...draft, brochure_url: "", brochure_filename: "" })
                          }
                        >
                          {t("brochureRemove")}
                        </Button>
                      ) : null}
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("orderLabel")}>
                    <Input
                      inputMode="numeric"
                      value={draft.sort_order}
                      onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
                    />
                  </Field>
                  <Field label={t("activeLabel")}>
                    <div className="flex h-9 items-center gap-2">
                      <Switch
                        checked={draft.active}
                        onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                      />
                      <span className="text-sm text-muted-foreground">
                        {draft.active ? t("active") : t("inactive")}
                      </span>
                    </div>
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{t("preview")}</p>
                <InteractivePreview
                  payload={{
                    kind: "buttons",
                    body: buildCardBody(previewCard),
                    header_image_url: draft.image_url || undefined,
                    buttons: cardButtons(previewCard),
                  }}
                />
                <p className="mt-2 text-xs text-muted-foreground">{t("previewNote")}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving || uploading !== null}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
      {help ? <p className="mt-1 text-[11px] text-muted-foreground">{help}</p> : null}
    </div>
  );
}
