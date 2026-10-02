"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import {
  EMPTY_FILTERS,
  GENERAL_MODEL,
  RESOURCE_FORMATS,
  RESOURCE_SEGMENTS,
  humanFileSize,
  isExternalResource,
  matchesResourceFilters,
  resourceDownloadUrl,
  type Resource,
  type ResourceFilters,
  type ResourceFormat,
  type ResourceKind,
  type ResourceSegment,
} from "@/lib/resources/resources";
import { ResourceDialog, SELECT_CLASS } from "./resource-dialog";

const BUCKET = "resources";
const OBJECT_MARKER = `/storage/v1/object/public/${BUCKET}/`;

/** Storage path of an uploaded file, for clean-up on delete. */
function storagePath(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf(OBJECT_MARKER);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + OBJECT_MARKER.length).split("?")[0]);
}

export function ResourceLibrary() {
  const t = useTranslations("Resources");
  const { account } = useAuth();
  const canManage = useCan("manage-campaigns");
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<Resource[]>([]);
  const [models, setModels] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ResourceFilters>(EMPTY_FILTERS);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const accountId = account?.id;

  // Spinner only on the first load; reloads after a save swap in place.
  const load = useCallback(async () => {
    if (!accountId) return;
    const [res, cards] = await Promise.all([
      supabase
        .from("resources")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false }),
      supabase
        .from("model_cards")
        .select("slug, name, sort_order")
        .eq("account_id", accountId)
        .order("sort_order", { ascending: true }),
    ]);
    if (!res.error) setItems((res.data ?? []) as Resource[]);
    if (!cards.error) setModels((cards.data ?? []) as { slug: string; name: string }[]);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    // Fetch on mount / account change; state is only set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const modelName = (slug: string | null) =>
    slug ? (models.find((m) => m.slug === slug)?.name ?? slug) : null;

  const visible = items.filter((r) =>
    matchesResourceFilters(r, { ...filters, includeInactive: canManage }),
  );
  const filtered =
    filters.query || filters.kind || filters.format || filters.model || filters.segment;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: Resource) => {
    setEditing(r);
    setDialogOpen(true);
  };

  const remove = async (r: Resource) => {
    if (!window.confirm(t("deleteConfirm", { title: r.title }))) return;
    const { error } = await supabase.from("resources").delete().eq("id", r.id);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
    // Best-effort: a leftover file only costs storage.
    const path = storagePath(r.file_url);
    if (path) void deleteAccountMedia(BUCKET, path).catch(() => {});
    toast.success(t("deleted"));
    setItems((list) => list.filter((x) => x.id !== r.id));
  };

  const copyCaption = async (r: Resource) => {
    try {
      await navigator.clipboard.writeText(r.caption ?? "");
      toast.success(t("captionCopied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const set = <K extends keyof ResourceFilters>(key: K, value: ResourceFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="mr-1 h-4 w-4" />
            {t("newResource")}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => set("query", e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <select
          className={SELECT_CLASS}
          aria-label={t("kindLabel")}
          value={filters.kind}
          onChange={(e) => set("kind", e.target.value as ResourceKind | "")}
        >
          <option value="">{t("allKinds")}</option>
          <option value="image">{t("kinds.image")}</option>
          <option value="video">{t("kinds.video")}</option>
        </select>
        <select
          className={SELECT_CLASS}
          aria-label={t("formatLabel")}
          value={filters.format}
          onChange={(e) => set("format", e.target.value as ResourceFormat | "")}
        >
          <option value="">{t("allFormats")}</option>
          {RESOURCE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {t(`formats.${f}`)}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          aria-label={t("modelLabel")}
          value={filters.model}
          onChange={(e) => set("model", e.target.value)}
        >
          <option value="">{t("allModels")}</option>
          <option value={GENERAL_MODEL}>{t("modelGeneral")}</option>
          {models.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          aria-label={t("segmentLabel")}
          value={filters.segment}
          onChange={(e) => set("segment", e.target.value as ResourceSegment | "")}
        >
          <option value="">{t("allSegments")}</option>
          {RESOURCE_SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {t(`segments.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
          <FolderOpen className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filtered ? t("emptyFiltered") : canManage ? t("emptyAdmin") : t("empty")}
          </p>
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t("clearFilters")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            {t("count", { count: visible.length })}
          </p>
          <ul className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((r) => (
              <ResourceCard
                key={r.id}
                r={r}
                modelName={modelName(r.model_slug)}
                canManage={canManage}
                onEdit={() => openEdit(r)}
                onDelete={() => remove(r)}
                onCopy={() => copyCaption(r)}
              />
            ))}
          </ul>
        </>
      )}

      {account?.id ? (
        <ResourceDialog
          open={dialogOpen}
          resource={editing}
          accountId={account.id}
          models={models}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function ResourceCard({
  r,
  modelName,
  canManage,
  onEdit,
  onDelete,
  onCopy,
}: {
  r: Resource;
  modelName: string | null;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const t = useTranslations("Resources");
  const href = resourceDownloadUrl(r);
  const external = isExternalResource(r);
  const size = humanFileSize(r.file_size);

  const chips = [
    t(`formats.${r.format}`),
    modelName,
    r.segment ? t(`segments.${r.segment}`) : null,
  ].filter(Boolean) as string[];

  return (
    <li
      className={
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card " +
        (r.active ? "" : "opacity-60")
      }
    >
      <div className="relative aspect-[4/5] bg-muted">
        {r.file_url && r.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.file_url}
            alt={r.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : r.file_url && r.kind === "video" ? (
          <video
            // `#t=0.1` makes Safari paint the first frame as a poster.
            src={`${r.file_url}#t=0.1`}
            preload="metadata"
            controls
            playsInline
            className="h-full w-full bg-black object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            {r.kind === "video" ? <Video className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
            <span className="text-xs">{t("externalPreview")}</span>
          </div>
        )}
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
          {r.kind === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          {t(`kinds.${r.kind}`)}
        </span>
        {!r.active ? (
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-black">
            {t("paused")}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{r.title}</p>
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </div>
        {r.caption ? (
          <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{r.caption}</p>
        ) : null}

        <div className="mt-auto flex items-center gap-2 pt-1">
          {href ? (
            <a
              href={href}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : { download: "" })}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {external ? <ExternalLink className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              {external ? t("open") : t("download")}
              {!external && size ? (
                <span className="text-xs font-normal opacity-80">· {size}</span>
              ) : null}
            </a>
          ) : null}
          {r.caption ? (
            <Button variant="outline" size="icon" onClick={onCopy} aria-label={t("copyCaption")} title={t("copyCaption")}>
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("edit")} title={t("edit")}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                aria-label={t("delete")}
                title={t("delete")}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}
