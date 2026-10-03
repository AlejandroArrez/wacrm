"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Loader2, Plus, Search, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SELECT_CLASS } from "@/components/resources/resource-dialog";
import { createClient } from "@/lib/supabase/client";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { waPhone } from "@/lib/outreach/outreach";
import { METRIC_BY_KEY, addDays, manualMetrics, todayMx, type PlanTrack } from "@/lib/plan/plan";
import { MetricIcon } from "./plan-ui";
import type { PlanMember } from "./use-plan";

const ANSWER_OUTCOMES = ["answered", "no_answer", "voicemail", "wrong_number"] as const;
const PRESENTATION_OUTCOMES = ["interested", "thinking", "not_interested"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactHit {
  id: string;
  name: string | null;
  phone: string;
}

export interface LoggedResult {
  metrics: string[];
  day: string;
}

export function LogDialog({
  open,
  initialMetric,
  track,
  accountId,
  userId,
  members,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialMetric: string | null;
  track: PlanTrack;
  accountId: string;
  userId: string;
  members: PlanMember[];
  onClose: () => void;
  onSaved: (r: LoggedResult) => void;
}) {
  const t = useTranslations("Plan");
  const supabase = useMemo(() => createClient(), []);
  const options = manualMetrics(track);

  const [metric, setMetric] = useState<string | null>(initialMetric);
  const [contact, setContact] = useState<ContactHit | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [memberId, setMemberId] = useState("");
  const [link, setLink] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [resources, setResources] = useState<{ id: string; title: string }[]>([]);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [daysBack, setDaysBack] = useState(0);
  const [saving, setSaving] = useState(false);

  const def = metric ? METRIC_BY_KEY[metric] : null;

  // Prospect search (RLS shows each advisor only their own).
  useEffect(() => {
    if (!open || !def?.needsContact || contact || creating) return;
    let cancelled = false;
    const q = query.trim().replace(/[%,()]/g, " ");
    const handle = setTimeout(async () => {
      setSearching(true);
      let req = supabase
        .from("contacts")
        .select("id, name, phone")
        .eq("account_id", accountId)
        .limit(6);
      req = q
        ? req.or(`name.ilike.%${q}%,phone.ilike.%${q.replace(/\D/g, "") || q}%`)
        : req.order("updated_at", { ascending: false });
      const { data } = await req;
      if (!cancelled) {
        setHits((data ?? []) as ContactHit[]);
        setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, def?.needsContact, contact, creating, query, accountId, supabase]);

  useEffect(() => {
    if (!open || !def?.needsLink || resources.length) return;
    let cancelled = false;
    void supabase
      .from("resources")
      .select("id, title")
      .eq("account_id", accountId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) setResources((data ?? []) as { id: string; title: string }[]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, def?.needsLink, resources.length, accountId, supabase]);

  const outcomes: readonly string[] = def?.asksAnswered
    ? ANSWER_OUTCOMES
    : metric === "presentations"
      ? PRESENTATION_OUTCOMES
      : [];

  const others = members.filter((m) => m.user_id !== userId && m.track);

  async function createContact(): Promise<ContactHit | null> {
    const digits = waPhone(newPhone);
    if (!newName.trim()) {
      toast.error(t("log.nameRequired"));
      return null;
    }
    if (!digits) {
      toast.error(t("log.phoneInvalid"));
      return null;
    }
    if (newEmail.trim() && !EMAIL_RE.test(newEmail.trim())) {
      toast.error(t("log.emailInvalid"));
      return null;
    }
    const phone = `+${digits}`;
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        user_id: userId,
        account_id: accountId,
        name: newName.trim(),
        phone,
        email: newEmail.trim() || null,
      })
      .select("id, name, phone")
      .single();
    if (!error && data) return data as ContactHit;
    if (isUniqueViolation(error)) {
      const existing = await findExistingContact(supabase, accountId, phone);
      if (existing) {
        toast.message(t("log.contactExists"));
        return { id: existing.id, name: existing.name ?? null, phone: existing.phone };
      }
      toast.error(t("log.contactTaken"));
      return null;
    }
    toast.error(t("log.saveFailed"));
    return null;
  }

  async function save() {
    if (!def || !metric) return;
    if (def.needsMember && !memberId) {
      toast.error(t("log.memberRequired"));
      return;
    }
    if (def.needsLink && link.trim() && !/^https?:\/\//i.test(link.trim())) {
      toast.error(t("log.linkInvalid"));
      return;
    }
    setSaving(true);
    try {
      let target = contact;
      if (def.needsContact && !target) {
        if (!creating) {
          toast.error(t("log.contactRequired"));
          return;
        }
        target = await createContact();
        if (!target) return;
      }
      const day = addDays(todayMx(), -daysBack);
      const occurredAt =
        daysBack === 0 ? new Date().toISOString() : new Date(`${day}T12:00:00-06:00`).toISOString();
      const base = {
        account_id: accountId,
        user_id: userId,
        source: "manual",
        occurred_at: occurredAt,
        contact_id: target?.id ?? null,
      };
      const rows: Record<string, unknown>[] = [
        {
          ...base,
          metric,
          member_id: def.needsMember ? memberId : null,
          resource_id: def.needsLink && resourceId ? resourceId : null,
          link: def.needsLink && link.trim() ? link.trim() : null,
          outcome: outcome ? t(`outcomes.${outcome}`) : null,
          note: note.trim() || null,
        },
      ];
      // A call where the prospect picked up is also a conversation.
      if (def.asksAnswered && outcome === "answered" && metric !== "conversations") {
        rows.push({ ...base, metric: "conversations" });
      }
      const { error } = await supabase.from("plan_activities").insert(rows);
      if (error) {
        toast.error(
          /too_old/.test(error.message) ? t("log.tooOld") : t("log.saveFailed"),
        );
        return;
      }
      onSaved({ metrics: rows.map((r) => String(r.metric)), day });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {metric && !initialMetric ? (
              <button
                type="button"
                onClick={() => {
                  setMetric(null);
                  setOutcome(null);
                }}
                className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("log.back")}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            {metric ? <MetricIcon metric={metric} className="h-4 w-4 text-[#C98222]" /> : null}
            {metric ? t(`metrics.${metric}`) : t("log.title")}
          </DialogTitle>
        </DialogHeader>

        {!metric ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {options.map((m) => {
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetric(m.key)}
                  className="flex min-h-20 flex-col items-start justify-between gap-2 rounded-xl border border-border bg-card p-3 text-left text-sm font-medium transition-colors hover:border-[#C98222] hover:bg-[#FEB161]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C98222]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEB161]/20 text-[#C98222]">
                    <MetricIcon metric={m.key} className="h-4 w-4" />
                  </span>
                  {t(`metrics.${m.key}`)}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Prospect */}
            {def?.needsContact ? (
              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("log.prospect")}
                </p>
                {contact ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-[#1A9488]/40 bg-[#1A9488]/10 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <Check className="h-4 w-4 shrink-0 text-[#1A9488]" aria-hidden />
                      <span className="truncate font-medium">{contact.name || contact.phone}</span>
                      <span className="truncate text-xs text-muted-foreground">{contact.phone}</span>
                    </span>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => setContact(null)}
                    >
                      {t("log.change")}
                    </button>
                  </div>
                ) : creating ? (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={t("log.newName")}
                      aria-label={t("log.newName")}
                      autoFocus
                    />
                    <Input
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder={t("log.newPhone")}
                      aria-label={t("log.newPhone")}
                      inputMode="tel"
                    />
                    <Input
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder={t("log.newEmail")}
                      aria-label={t("log.newEmail")}
                      inputMode="email"
                    />
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => setCreating(false)}
                    >
                      {t("log.searchInstead")}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("log.searchPlaceholder")}
                        aria-label={t("log.searchPlaceholder")}
                        className="pl-8"
                      />
                    </div>
                    <ul className="max-h-48 space-y-1 overflow-y-auto">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            onClick={() => setContact(h)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
                          >
                            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate font-medium">{h.name || h.phone}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{h.phone}</span>
                          </button>
                        </li>
                      ))}
                      {!searching && hits.length === 0 ? (
                        <li className="px-2 py-2 text-xs text-muted-foreground">{t("log.noMatches")}</li>
                      ) : null}
                    </ul>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="w-full"
                      onClick={() => {
                        setCreating(true);
                        if (query.trim() && !/\d{4,}/.test(query)) setNewName(query.trim());
                        else if (query.trim()) setNewPhone(query.trim());
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      {t("log.newProspect")}
                    </Button>
                  </div>
                )}
              </section>
            ) : null}

            {/* One-on-one with a team member */}
            {def?.needsMember ? (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("log.member")}
                </span>
                <select
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("log.memberPick")}</option>
                  {others.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {/* Social post */}
            {def?.needsLink ? (
              <div className="space-y-2">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("log.link")}
                  </span>
                  <Input
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://instagram.com/p/…"
                    inputMode="url"
                  />
                </label>
                {resources.length ? (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("log.resource")}
                    </span>
                    <select
                      value={resourceId}
                      onChange={(e) => setResourceId(e.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">{t("log.resourceNone")}</option>
                      {resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            {/* Outcome */}
            {outcomes.length ? (
              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("log.outcome")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {outcomes.map((o) => (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={outcome === o}
                      onClick={() => setOutcome(outcome === o ? null : o)}
                      className={
                        "min-h-9 rounded-full border px-3 text-sm transition-colors " +
                        (outcome === o
                          ? "border-[#C98222] bg-[#FEB161]/25 font-medium text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground")
                      }
                    >
                      {t(`outcomes.${o}`)}
                    </button>
                  ))}
                </div>
                {def?.asksAnswered && metric !== "conversations" ? (
                  <p className="text-xs text-muted-foreground">{t("log.answeredHint")}</p>
                ) : null}
              </section>
            ) : null}

            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("log.note")}
              </span>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                rows={2}
                placeholder={t("log.notePlaceholder")}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("log.when")}</span>
              {[0, 1, 2].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={daysBack === d}
                  onClick={() => setDaysBack(d)}
                  className={
                    "min-h-8 rounded-full border px-3 text-xs transition-colors " +
                    (daysBack === d
                      ? "border-[#C98222] bg-[#FEB161]/25 font-medium text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground")
                  }
                >
                  {t(`log.daysBack.${d}`)}
                </button>
              ))}
            </div>

            {def?.needsContact ? (
              <p className="text-xs text-muted-foreground">{t("log.noteOnFile")}</p>
            ) : null}

            <Button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-11 w-full bg-[#FEB161] text-base font-semibold text-[#2C3B4E] hover:bg-[#FEB161]/90"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t("log.save")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
