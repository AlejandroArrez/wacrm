"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link2, Loader2, Upload } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";
import { uploadAccountMedia } from "@/lib/storage/upload-media";
import {
  CAPTION_MAX,
  RESOURCE_FORMATS,
  RESOURCE_MAX_BYTES,
  RESOURCE_MIME_TYPES,
  RESOURCE_SEGMENTS,
  TITLE_MAX,
  humanFileSize,
  kindFromMime,
  type Resource,
  type ResourceFormat,
  type ResourceKind,
  type ResourceSegment,
} from "@/lib/resources/resources";

const BUCKET = "resources";

export const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type Source = "file" | "link";

interface Draft {
  id?: string;
  title: string;
  caption: string;
  format: ResourceFormat;
  model_slug: string;
  segment: ResourceSegment | "";
  source: Source;
  kind: ResourceKind;
  file_url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string;
  external_url: string;
  active: boolean;
}

function emptyDraft(): Draft {
  return {
    title: "",
    caption: "",
    format: "post",
    model_slug: "",
    segment: "",
    source: "file",
    kind: "image",
    file_url: "",
    file_name: "",
    file_size: null,
    mime_type: "",
    external_url: "",
    active: true,
  };
}

function toDraft(r: Resource): Draft {
  return {
    id: r.id,
    title: r.title,
    caption: r.caption ?? "",
    format: r.format,
    model_slug: r.model_slug ?? "",
    segment: r.segment ?? "",
    source: r.file_url ? "file" : "link",
    kind: r.kind,
    file_url: r.file_url ?? "",
    file_name: r.file_name ?? "",
    file_size: r.file_size,
    mime_type: r.mime_type ?? "",
    external_url: r.external_url ?? "",
    active: r.active,
  };
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      {children}
      {help ? <p className="mt-1 text-[11px] text-muted-foreground">{help}</p> : null}
    </div>
  );
}

export function ResourceDialog({
  open,
  resource,
  accountId,
  models,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create. */
  resource: Resource | null;
  accountId: string;
  models: { slug: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Resources");
  const supabase = useMemo(() => createClient(), []);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setDraft(resource ? toDraft(resource) : emptyDraft());
  }, [open, resource]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const kind = kindFromMime(file.type);
      if (!kind) {
        toast.error(t("fileInvalid"));
        return;
      }
      if (file.size > RESOURCE_MAX_BYTES) {
        toast.error(t("fileTooBig"));
        return;
      }
      setUploading(true);
      const { publicUrl } = await uploadAccountMedia(BUCKET, file);
      setDraft((d) => ({
        ...d,
        kind,
        file_url: publicUrl,
        file_name: file.name.slice(0, 200),
        file_size: file.size,
        mime_type: file.type,
        // Suggest the title from the file name the first time.
        title: d.title || file.name.replace(/\.[^.]+$/, "").slice(0, TITLE_MAX),
      }));
    } catch {
      toast.error(t("uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      toast.error(t("titleRequired"));
      return;
    }
    const link = draft.external_url.trim();
    if (draft.source === "file" && !draft.file_url) {
      toast.error(t("fileRequired"));
      return;
    }
    if (draft.source === "link" && !/^https?:\/\/\S+$/i.test(link)) {
      toast.error(t("linkInvalid"));
      return;
    }
    const isFile = draft.source === "file";
    const row = {
      account_id: accountId,
      title,
      caption: draft.caption.trim() || null,
      kind: draft.kind,
      format: draft.format,
      model_slug: draft.model_slug || null,
      segment: draft.segment || null,
      file_url: isFile ? draft.file_url : null,
      file_name: isFile ? draft.file_name || null : null,
      file_size: isFile ? draft.file_size : null,
      mime_type: isFile ? draft.mime_type || null : null,
      external_url: isFile ? null : link,
      active: draft.active,
    };
    setSaving(true);
    try {
      const { error } = draft.id
        ? await supabase.from("resources").update(row).eq("id", draft.id)
        : await supabase.from("resources").insert(row);
      if (error) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const accept = RESOURCE_MIME_TYPES.join(",");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{draft.id ? t("editTitle") : t("newTitle")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {/* Source */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["file", "link"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setDraft({ ...draft, source: s })}
                className={
                  "flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors " +
                  (draft.source === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
                aria-pressed={draft.source === s}
              >
                {s === "file" ? <Upload className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {s === "file" ? t("sourceFile") : t("sourceLink")}
              </button>
            ))}
          </div>

          {draft.source === "file" ? (
            <Field label={t("fileLabel")} help={t("fileHelp")}>
              <input
                ref={fileInput}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1 h-4 w-4" />
                  )}
                  {uploading ? t("uploading") : draft.file_url ? t("fileReplace") : t("fileUpload")}
                </Button>
                {draft.file_url ? (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {draft.file_name}
                    {draft.file_size != null ? ` · ${humanFileSize(draft.file_size)}` : ""}
                  </span>
                ) : null}
              </div>
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
              <Field label={t("linkLabel")} help={t("linkHelp")}>
                <Input
                  value={draft.external_url}
                  placeholder="https://drive.google.com/…"
                  onChange={(e) => setDraft({ ...draft, external_url: e.target.value })}
                />
              </Field>
              <Field label={t("kindLabel")}>
                <select
                  className={SELECT_CLASS}
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as ResourceKind })}
                >
                  <option value="image">{t("kinds.image")}</option>
                  <option value="video">{t("kinds.video")}</option>
                </select>
              </Field>
            </div>
          )}

          <Field label={t("titleLabel")}>
            <Input
              value={draft.title}
              maxLength={TITLE_MAX}
              placeholder={t("titlePlaceholder")}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>

          <Field
            label={t("captionLabel")}
            help={t("captionCount", { count: draft.caption.length, max: CAPTION_MAX })}
          >
            <Textarea
              value={draft.caption}
              maxLength={CAPTION_MAX}
              placeholder={t("captionPlaceholder")}
              onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              className="min-h-24"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("formatLabel")}>
              <select
                className={SELECT_CLASS}
                value={draft.format}
                onChange={(e) => setDraft({ ...draft, format: e.target.value as ResourceFormat })}
              >
                {RESOURCE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {t(`formats.${f}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("modelLabel")}>
              <select
                className={SELECT_CLASS}
                value={draft.model_slug}
                onChange={(e) => setDraft({ ...draft, model_slug: e.target.value })}
              >
                <option value="">{t("modelGeneral")}</option>
                {models.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.name}
                  </option>
                ))}
                {/* Keep a model that was removed from the fichas visible. */}
                {draft.model_slug && !models.some((m) => m.slug === draft.model_slug) ? (
                  <option value={draft.model_slug}>{draft.model_slug}</option>
                ) : null}
              </select>
            </Field>
            <Field label={t("segmentLabel")}>
              <select
                className={SELECT_CLASS}
                value={draft.segment}
                onChange={(e) =>
                  setDraft({ ...draft, segment: e.target.value as ResourceSegment | "" })
                }
              >
                <option value="">{t("segmentAll")}</option>
                {RESOURCE_SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`segments.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span>
              <span className="block text-sm text-foreground">{t("activeLabel")}</span>
              <span className="block text-[11px] text-muted-foreground">{t("activeHelp")}</span>
            </span>
            <Switch
              checked={draft.active}
              onCheckedChange={(v) => setDraft({ ...draft, active: v })}
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving || uploading}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
