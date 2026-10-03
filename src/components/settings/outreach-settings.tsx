"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { SettingsPanelHead } from "./settings-panel-head";
import { SELECT_CLASS } from "@/components/resources/resource-dialog";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  DEFAULT_DAILY_LIMIT,
  OUTREACH_SEGMENTS,
  TEMPLATE_BODY_MAX,
  TEMPLATE_NAME_MAX,
  TEMPLATE_VARIABLES,
  fillTemplate,
  type OutreachSegment,
  type OutreachTemplate,
} from "@/lib/outreach/outreach";

interface Draft {
  id?: string;
  name: string;
  body: string;
  segment: OutreachSegment | "";
  campaign_tag: string;
  active: boolean;
  sort_order: string;
}

const emptyDraft = (order: number): Draft => ({
  name: "",
  body: "",
  segment: "",
  campaign_tag: "",
  active: true,
  sort_order: String(order),
});

export function OutreachSettings() {
  const t = useTranslations("OutreachSettings");
  const tOut = useTranslations("Outreach");
  const { account, profile } = useAuth();
  const canEdit = useCan("manage-campaigns");
  const supabase = useMemo(() => createClient(), []);
  const accountId = account?.id;

  const [items, setItems] = useState<OutreachTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(String(DEFAULT_DAILY_LIMIT));
  const [savedLimit, setSavedLimit] = useState(String(DEFAULT_DAILY_LIMIT));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [tplRes, accRes] = await Promise.all([
      supabase
        .from("outreach_templates")
        .select("*")
        .eq("account_id", accountId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("accounts").select("*").eq("id", accountId).maybeSingle(),
    ]);
    if (!tplRes.error) setItems((tplRes.data ?? []) as OutreachTemplate[]);
    const l = Number((accRes.data as Record<string, unknown> | null)?.outreach_daily_limit);
    if (Number.isFinite(l) && l > 0) {
      setLimit(String(l));
      setSavedLimit(String(l));
    }
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveLimit = async () => {
    const n = Number(limit);
    if (!accountId || !Number.isInteger(n) || n < 1 || n > 500) {
      toast.error(t("limitInvalid"));
      return;
    }
    const { error } = await supabase
      .from("accounts")
      .update({ outreach_daily_limit: n })
      .eq("id", accountId);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setSavedLimit(String(n));
    toast.success(t("limitSaved"));
  };

  const save = async () => {
    if (!draft || !accountId) return;
    const name = draft.name.trim();
    const body = draft.body.trim();
    if (!name || !body) {
      toast.error(t("required"));
      return;
    }
    const row = {
      account_id: accountId,
      name,
      body,
      segment: draft.segment || null,
      campaign_tag: draft.campaign_tag.trim() || null,
      active: draft.active,
      sort_order: Number.parseInt(draft.sort_order, 10) || 0,
    };
    setSaving(true);
    try {
      const { error } = draft.id
        ? await supabase.from("outreach_templates").update(row).eq("id", draft.id)
        : await supabase.from("outreach_templates").insert(row);
      if (error) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (tpl: OutreachTemplate) => {
    if (!window.confirm(t("deleteConfirm", { name: tpl.name }))) return;
    const { error } = await supabase.from("outreach_templates").delete().eq("id", tpl.id);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
    setItems((list) => list.filter((x) => x.id !== tpl.id));
  };

  const toggle = async (tpl: OutreachTemplate, active: boolean) => {
    const { error } = await supabase.from("outreach_templates").update({ active }).eq("id", tpl.id);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setItems((list) => list.map((x) => (x.id === tpl.id ? { ...x, active } : x)));
  };

  const preview = draft
    ? fillTemplate(draft.body, {
        contactName: t("previewName"),
        advisorName: profile?.full_name ?? null,
        advisorPhone: t("previewPhone"),
      })
    : "";

  return (
    <div>
      <SettingsPanelHead
        title={t("title")}
        description={t("description")}
        action={
          canEdit ? (
            <Button
              onClick={() =>
                setDraft(emptyDraft(items.reduce((m, x) => Math.max(m, x.sort_order), 0) + 1))
              }
            >
              <Plus className="mr-1 h-4 w-4" />
              {t("newTemplate")}
            </Button>
          ) : null
        }
      />

      {!canEdit && <p className="mb-4 text-xs text-muted-foreground">{t("readOnly")}</p>}

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div>
          <label htmlFor="outreach-limit" className="mb-1 block text-xs text-muted-foreground">
            {t("limitLabel")}
          </label>
          <Input
            id="outreach-limit"
            type="number"
            min={1}
            max={500}
            value={limit}
            disabled={!canEdit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-28"
          />
        </div>
        {canEdit ? (
          <Button variant="outline" onClick={saveLimit} disabled={limit === savedLimit}>
            {t("limitSave")}
          </Button>
        ) : null}
        <p className="basis-full text-[11px] text-muted-foreground">{t("limitHelp")}</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((tpl) => (
            <li key={tpl.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {[
                    tpl.segment ? tOut(`segments.${tpl.segment}`) : t("anySegment"),
                    tpl.campaign_tag,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                  {tpl.body}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={tpl.active}
                  disabled={!canEdit}
                  onCheckedChange={(v) => toggle(tpl, v)}
                  aria-label={t("activeLabel")}
                />
                {canEdit ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("edit")}
                      onClick={() =>
                        setDraft({
                          id: tpl.id,
                          name: tpl.name,
                          body: tpl.body,
                          segment: tpl.segment ?? "",
                          campaign_tag: tpl.campaign_tag ?? "",
                          active: tpl.active,
                          sort_order: String(tpl.sort_order),
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("delete")}
                      onClick={() => remove(tpl)}
                      className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("editTitle") : t("newTitle")}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t("nameLabel")}</p>
                <Input
                  value={draft.name}
                  maxLength={TEMPLATE_NAME_MAX}
                  placeholder={t("namePlaceholder")}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t("bodyLabel")}</p>
                <Textarea
                  value={draft.body}
                  maxLength={TEMPLATE_BODY_MAX}
                  placeholder={t("bodyPlaceholder")}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className="min-h-32"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("variablesHelp", { vars: TEMPLATE_VARIABLES.join("  ") })}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">{t("segmentLabel")}</p>
                  <select
                    className={SELECT_CLASS}
                    value={draft.segment}
                    onChange={(e) =>
                      setDraft({ ...draft, segment: e.target.value as OutreachSegment | "" })
                    }
                  >
                    <option value="">{t("anySegment")}</option>
                    {OUTREACH_SEGMENTS.map((s) => (
                      <option key={s} value={s}>
                        {tOut(`segments.${s}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">{t("campaignLabel")}</p>
                  <Input
                    value={draft.campaign_tag}
                    maxLength={60}
                    placeholder="campaña:feria"
                    onChange={(e) => setDraft({ ...draft, campaign_tag: e.target.value })}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">{t("orderLabel")}</p>
                  <Input
                    inputMode="numeric"
                    value={draft.sort_order}
                    onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("matchHelp")}</p>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span className="text-sm text-foreground">{t("activeLabel")}</span>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </label>
              {preview ? (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">{t("preview")}</p>
                  <p className="whitespace-pre-line rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                    {preview}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
