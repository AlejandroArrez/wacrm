"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Loader2, MessageCircle, Search, Send, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { useProspectOwners } from "@/hooks/use-prospect-owners";
import {
  DEFAULT_DAILY_LIMIT,
  OUTREACH_SEGMENTS,
  QUEUE_TABS,
  foldTag,
  queueTab,
  segmentFromTags,
  sourceTags,
  type OutreachQueueRow,
  type OutreachSegment,
  type OutreachTemplate,
  type QueueTab,
} from "@/lib/outreach/outreach";
import { SELECT_CLASS } from "@/components/resources/resource-dialog";
import { OutreachDialog, type Quota } from "./outreach-dialog";

/** Rows loaded per visit. Enough for the lists Porta Magna works with. */
const MAX_ROWS = 1000;

type OwnerFilter = "all" | "none" | string;

export function OutreachQueue() {
  const t = useTranslations("Outreach");
  const format = useFormatter();
  const { account, user, profile } = useAuth();
  const seesAll = useCan("see-all-prospects");
  const canImport = useCan("manage-campaigns");
  const { members } = useProspectOwners();
  const supabase = useMemo(() => createClient(), []);

  const accountId = account?.id;
  const userId = user?.id;

  const [rows, setRows] = useState<OutreachQueueRow[]>([]);
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [myPhone, setMyPhone] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [tab, setTab] = useState<QueueTab>("pending");
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<OutreachSegment | "">("");
  const [owner, setOwner] = useState<OwnerFilter>("none");
  const [active, setActive] = useState<OutreachQueueRow | null>(null);

  const load = useCallback(async () => {
    if (!accountId || !userId) return;
    const [queueRes, tplRes, meRes, quotaRes] = await Promise.all([
      supabase
        .from("outreach_queue")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS),
      supabase
        .from("outreach_templates")
        .select("*")
        .eq("account_id", accountId)
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.rpc("outreach_my_quota", { p_account_id: accountId }),
    ]);
    setFailed(!!queueRes.error);
    if (!queueRes.error) setRows((queueRes.data ?? []) as OutreachQueueRow[]);
    if (!tplRes.error) setTemplates((tplRes.data ?? []) as OutreachTemplate[]);
    const phone = (meRes.data as Record<string, unknown> | null)?.whatsapp_phone;
    setMyPhone(typeof phone === "string" && phone.trim() ? phone : null);
    const q = Array.isArray(quotaRes.data) ? quotaRes.data[0] : quotaRes.data;
    if (q) {
      setQuota({
        used: Number(q.used) || 0,
        limit: Number(q.daily_limit) || DEFAULT_DAILY_LIMIT,
      });
    }
    setLoading(false);
  }, [accountId, userId, supabase]);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const ownerName = (id: string | null) =>
    id ? (members.find((m) => m.user_id === id)?.full_name ?? t("unknownOwner")) : t("noOwner");

  // Everything but the tab, so the tab counters follow the filters.
  const filtered = rows.filter((r) => {
    if (seesAll) {
      if (owner === "none" && r.owner_id) return false;
      if (owner !== "all" && owner !== "none" && r.owner_id !== owner) return false;
    }
    if (segment && segmentFromTags(r.tags) !== segment) return false;
    const q = foldTag(query);
    if (q) {
      const hay = foldTag(`${r.name ?? ""} ${r.phone} ${r.tags.join(" ")}`);
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  const counts = QUEUE_TABS.reduce(
    (acc, k) => ({ ...acc, [k]: filtered.filter((r) => queueTab(r) === k).length }),
    {} as Record<QueueTab, number>,
  );
  const visible = filtered.filter((r) => queueTab(r) === tab);

  const shortDate = (iso: string) =>
    format.dateTime(new Date(iso), { day: "numeric", month: "short" });

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {quota ? (
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              {t("quota", { used: quota.used, limit: quota.limit })}
            </span>
          ) : null}
          {canImport ? (
            <Link
              href="/contacts"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Upload className="h-3.5 w-3.5" />
              {t("importHint")}
            </Link>
          ) : null}
        </div>
      </div>

      {!loading && !myPhone ? (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
          {t("noPhoneWarning")}{" "}
          <Link href="/settings?tab=profile" className="underline">
            {t("noPhoneLink")}
          </Link>
        </p>
      ) : null}

      {/* Tabs */}
      <div className="mt-5 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
        {QUEUE_TABS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (tab === k
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {t(`tabs.${k}`)}
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[11px] tabular-nums">
              {counts[k]}
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div
        className={
          "mt-3 grid grid-cols-2 gap-2 " +
          (seesAll
            ? "lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]"
            : "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")
        }
      >
        <div className={"relative " + (seesAll ? "col-span-2 lg:col-span-1" : "")}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-8"
          />
        </div>
        <select
          className={SELECT_CLASS}
          aria-label={t("segmentLabel")}
          value={segment}
          onChange={(e) => setSegment(e.target.value as OutreachSegment | "")}
        >
          <option value="">{t("allSegments")}</option>
          {OUTREACH_SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {t(`segments.${s}`)}
            </option>
          ))}
        </select>
        {seesAll ? (
          <select
            className={SELECT_CLASS}
            aria-label={t("ownerLabel")}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="none">{t("ownerNone")}</option>
            <option value="all">{t("ownerAll")}</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user_id === userId ? t("ownerMe", { name: m.full_name }) : m.full_name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : failed ? (
        <p className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {t("loadFailed")}
        </p>
      ) : visible.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-14 text-center">
          <Send className="h-6 w-6 text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">{t(`empty.${tab}`)}</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {visible.map((r) => {
            const seg = segmentFromTags(r.tags);
            const sources = sourceTags(r.tags);
            return (
              <li key={r.contact_id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {r.name || t("noName")}
                    </p>
                    <span className="text-xs text-muted-foreground">{r.phone}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {seg ? (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {t(`segments.${seg}`)}
                      </span>
                    ) : null}
                    {sources.map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {[
                      t("registered", { date: shortDate(r.created_at) }),
                      seesAll ? ownerName(r.owner_id) : null,
                      r.last_attempt_at
                        ? t("lastAttempt", {
                            date: shortDate(r.last_attempt_at),
                            result: t(`results.${r.last_result ?? "sent"}`),
                            count: r.attempts,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {tab === "chatting" ? (
                    <Link
                      href="/inbox"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-foreground hover:bg-muted"
                    >
                      {t("openInbox")}
                    </Link>
                  ) : null}
                  <Button size="sm" onClick={() => setActive(r)} className="h-8">
                    <MessageCircle className="mr-1 h-4 w-4" />
                    {tab === "followup" ? t("followUp") : tab === "done" ? t("contactAgain") : t("contact")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length >= MAX_ROWS ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("truncated", { max: MAX_ROWS })}</p>
      ) : null}

      {accountId ? (
        <OutreachDialog
          key={active?.contact_id ?? "none"}
          row={active}
          accountId={accountId}
          templates={templates}
          advisorName={profile?.full_name ?? null}
          advisorPhone={myPhone}
          quota={quota}
          onClose={() => setActive(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
