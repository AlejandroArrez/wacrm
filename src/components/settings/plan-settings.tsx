"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsPanelHead } from "./settings-panel-head";
import { SELECT_CLASS } from "@/components/resources/resource-dialog";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { isAccountRole } from "@/lib/auth/roles";
import {
  DEFAULT_SETTINGS,
  PLAN_PERIODS,
  PLAN_TRACKS,
  effectiveTrack,
  trackMetrics,
  type PlanGoal,
  type PlanPeriod,
  type PlanTrack,
} from "@/lib/plan/plan";

/** Brokers are measured on results only. */
const BROKER_METRICS = ["prospects_registered", "appointments_set", "presentations", "reservations", "sales"];
const BROKER_PERIODS: PlanPeriod[] = ["month", "quarter"];
const PRIZE_LEVELS: PlanPeriod[] = ["week", "month", "quarter"];
const TRACK_CHOICES = ["", "advisor", "broker", "director", "none"] as const;

interface Member {
  user_id: string;
  full_name: string;
  role: string | null;
  plan_track: string | null;
  plan_opt_in: boolean;
}

interface Prize {
  id?: string;
  track: PlanTrack;
  level: PlanPeriod;
  title: string;
  description: string;
  image_url: string;
  active: boolean;
}

export function PlanSettings() {
  const t = useTranslations("PlanSettings");
  const tp = useTranslations("Plan");
  const { accountId } = useAuth();
  const canEdit = useCan("edit-settings");
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [workdays, setWorkdays] = useState<number[]>(DEFAULT_SETTINGS.workdays);
  const [weekDays, setWeekDays] = useState(String(DEFAULT_SETTINGS.weekDaysRequired));
  const [monthWeeks, setMonthWeeks] = useState(String(DEFAULT_SETTINGS.monthWeeksRequired));
  const [followDays, setFollowDays] = useState("3");
  const [goals, setGoals] = useState<(PlanGoal & { id: string })[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [track, setTrack] = useState<PlanTrack>("advisor");
  const [savingGeneral, setSavingGeneral] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [accRes, goalsRes, prizesRes, membersRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("id", accountId).maybeSingle(),
      supabase
        .from("plan_goals")
        .select("id, track, period, metric, target, sort_order")
        .eq("account_id", accountId)
        .order("sort_order"),
      supabase.from("plan_prizes").select("*").eq("account_id", accountId),
      supabase.from("profiles").select("*").eq("account_id", accountId).order("full_name"),
    ]);
    const acc = accRes.data as Record<string, unknown> | null;
    if (acc) {
      if (Array.isArray(acc.plan_workdays)) setWorkdays((acc.plan_workdays as number[]).map(Number));
      if (acc.plan_week_days_required) setWeekDays(String(acc.plan_week_days_required));
      if (acc.plan_month_weeks_required) setMonthWeeks(String(acc.plan_month_weeks_required));
      if (acc.plan_followup_days) setFollowDays(String(acc.plan_followup_days));
    }
    if (!goalsRes.error) setGoals((goalsRes.data ?? []) as (PlanGoal & { id: string })[]);
    if (!prizesRes.error) {
      setPrizes(
        (prizesRes.data ?? []).map((p: Record<string, unknown>) => ({
          id: String(p.id),
          track: p.track as PlanTrack,
          level: p.level as PlanPeriod,
          title: String(p.title ?? ""),
          description: String(p.description ?? ""),
          image_url: String(p.image_url ?? ""),
          active: p.active !== false,
        })),
      );
    }
    if (!membersRes.error) {
      setMembers(
        (membersRes.data ?? []).map((p: Record<string, unknown>) => ({
          user_id: String(p.user_id),
          full_name: (p.full_name as string) || (p.email as string) || "",
          role: (p.account_role as string) ?? null,
          plan_track: (p.plan_track as string) ?? null,
          plan_opt_in: p.plan_opt_in !== false,
        })),
      );
    }
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // ---------------- General
  const saveGeneral = async () => {
    const wd = Number(weekDays);
    const mw = Number(monthWeeks);
    const fd = Number(followDays);
    if (!accountId) return;
    if (!workdays.length || !Number.isInteger(wd) || wd < 1 || wd > workdays.length) {
      toast.error(t("weekDaysInvalid", { max: workdays.length }));
      return;
    }
    if (!Number.isInteger(mw) || mw < 1 || mw > 5 || !Number.isInteger(fd) || fd < 1 || fd > 30) {
      toast.error(t("numbersInvalid"));
      return;
    }
    setSavingGeneral(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        plan_workdays: [...workdays].sort(),
        plan_week_days_required: wd,
        plan_month_weeks_required: mw,
        plan_followup_days: fd,
      })
      .eq("id", accountId);
    setSavingGeneral(false);
    if (error) toast.error(t("saveFailed"));
    else toast.success(t("saved"));
  };

  // ---------------- Goals
  const updateTarget = async (id: string, raw: string) => {
    const n = Number(raw);
    const current = goals.find((g) => g.id === id);
    if (!current || n === current.target) return;
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      toast.error(t("targetInvalid"));
      return;
    }
    const { error } = await supabase.from("plan_goals").update({ target: n }).eq("id", id);
    if (error) toast.error(t("saveFailed"));
    else {
      setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, target: n } : g)));
      toast.success(t("saved"));
    }
  };

  const removeGoal = async (id: string) => {
    const { error } = await supabase.from("plan_goals").delete().eq("id", id);
    if (error) toast.error(t("saveFailed"));
    else setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const addGoal = async (period: PlanPeriod, metric: string, target: number) => {
    if (!accountId) return;
    if (!Number.isInteger(target) || target < 1 || target > 10000) {
      toast.error(t("targetInvalid"));
      return;
    }
    const maxOrder = goals.reduce((m, g) => Math.max(m, g.sort_order), 0);
    const { data, error } = await supabase
      .from("plan_goals")
      .insert({ account_id: accountId, track, period, metric, target, sort_order: maxOrder + 1 })
      .select("id, track, period, metric, target, sort_order")
      .single();
    if (error || !data) toast.error(t("saveFailed"));
    else setGoals((prev) => [...prev, data as PlanGoal & { id: string }]);
  };

  // ---------------- Prizes
  const savePrize = async (p: Prize) => {
    if (!accountId) return;
    const title = p.title.trim();
    if (!title) {
      toast.error(t("prizeTitleRequired"));
      return;
    }
    if (p.image_url.trim() && !/^https?:\/\//i.test(p.image_url.trim())) {
      toast.error(t("imageInvalid"));
      return;
    }
    const { error } = await supabase.from("plan_prizes").upsert(
      {
        account_id: accountId,
        track: p.track,
        level: p.level,
        title: title.slice(0, 80),
        description: p.description.trim().slice(0, 300) || null,
        image_url: p.image_url.trim() || null,
        active: p.active,
      },
      { onConflict: "account_id,track,level" },
    );
    if (error) toast.error(t("saveFailed"));
    else {
      toast.success(t("saved"));
      void load();
    }
  };

  // ---------------- Members
  const setMemberTrack = async (userId: string, value: string) => {
    const { error } = await supabase.rpc("set_member_plan_track", {
      p_user_id: userId,
      p_track: value || null,
    });
    if (error) toast.error(t("saveFailed"));
    else {
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, plan_track: value || null } : m)));
      toast.success(t("saved"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  const periods = track === "broker" ? BROKER_PERIODS : PLAN_PERIODS;
  const metricsFor = trackMetrics(track).filter((m) => track !== "broker" || BROKER_METRICS.includes(m.key));

  return (
    <div className="space-y-8">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      {!canEdit ? (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">{t("readOnly")}</p>
      ) : null}

      {/* General */}
      <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
        <h3 className="font-semibold">{t("generalTitle")}</h3>
        <div>
          <p className="text-sm font-medium">{t("workdays")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = workdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={on}
                  onClick={() => setWorkdays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))}
                  className={
                    "h-9 min-w-11 rounded-lg border px-2 text-sm font-medium transition-colors disabled:opacity-60 " +
                    (on ? "border-[#C98222] bg-[#FEB161]/25 text-foreground" : "border-border text-muted-foreground")
                  }
                >
                  {t(`weekdays.${d}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label={t("weekDays")} help={t("weekDaysHelp")} value={weekDays} onChange={setWeekDays} disabled={!canEdit} />
          <NumberField label={t("monthWeeks")} help={t("monthWeeksHelp")} value={monthWeeks} onChange={setMonthWeeks} disabled={!canEdit} />
          <NumberField label={t("followDays")} help={t("followDaysHelp")} value={followDays} onChange={setFollowDays} disabled={!canEdit} />
        </div>
        {canEdit ? (
          <Button type="button" onClick={saveGeneral} disabled={savingGeneral}>
            {savingGeneral ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("save")}
          </Button>
        ) : null}
      </section>

      {/* Members */}
      <section className="space-y-3 rounded-xl border border-border p-4 sm:p-5">
        <div>
          <h3 className="font-semibold">{t("membersTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("membersHelp")}</p>
        </div>
        <ul className="divide-y divide-border">
          {members.map((m) => {
            const role = isAccountRole(m.role) ? m.role : null;
            const auto = effectiveTrack(null, role);
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.role ? t(`roles.${m.role}`) : ""}
                    {m.plan_track === "broker" || (!m.plan_track && auto === "broker")
                      ? ` · ${m.plan_opt_in ? t("optedIn") : t("optedOut")}`
                      : ""}
                  </p>
                </div>
                <div className="w-full sm:w-56">
                <select
                  value={m.plan_track ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => void setMemberTrack(m.user_id, e.target.value)}
                  className={SELECT_CLASS}
                  aria-label={t("trackFor", { name: m.full_name })}
                >
                  {TRACK_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {c === "" ? t("trackAuto", { track: auto ? tp(`tracks.${auto}`) : t("trackNone") }) : c === "none" ? t("trackNone") : tp(`tracks.${c}`)}
                    </option>
                  ))}
                </select>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Goals */}
      <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{t("goalsTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`goalsHelp.${track}`)}</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {PLAN_TRACKS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={track === k}
                onClick={() => setTrack(k)}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (track === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
              >
                {tp(`tracks.${k}`)}
              </button>
            ))}
          </div>
        </div>

        {periods.map((p) => {
          const rows = goals.filter((g) => g.track === track && g.period === p);
          const used = new Set(rows.map((g) => g.metric));
          const free = metricsFor.filter((m) => !used.has(m.key));
          return (
            <div key={p} className="rounded-lg border border-border">
              <p className="border-b border-border bg-muted/50 px-3 py-2 text-sm font-medium">{tp(`periodsLong.${p}`)}</p>
              <ul className="divide-y divide-border">
                {rows.map((g) => (
                  <li key={g.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{tp(`metrics.${g.metric}`)}</span>
                    <Input
                      type="number"
                      min={1}
                      max={10000}
                      defaultValue={g.target}
                      disabled={!canEdit}
                      onBlur={(e) => void updateTarget(g.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="h-8 w-20 text-right tabular-nums"
                      aria-label={t("targetFor", { metric: tp(`metrics.${g.metric}`) })}
                    />
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => void removeGoal(g.id)}
                        aria-label={t("removeGoal")}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
                {rows.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">{t("noGoals")}</li>
                ) : null}
              </ul>
              {canEdit && free.length ? (
                <AddGoal
                  key={`${track}-${p}-${rows.length}`}
                  options={free.map((m) => ({ key: m.key, label: tp(`metrics.${m.key}`) }))}
                  onAdd={(metric, target) => void addGoal(p, metric, target)}
                />
              ) : null}
            </div>
          );
        })}
      </section>

      {/* Prizes */}
      <section className="space-y-4 rounded-xl border border-border p-4 sm:p-5">
        <div>
          <h3 className="font-semibold">{t("prizesTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("prizesHelp")}</p>
        </div>
        {(track === "broker" ? BROKER_PERIODS : PRIZE_LEVELS).map((level) => {
          const existing = prizes.find((x) => x.track === track && x.level === level);
          return (
            <PrizeEditor
              key={`${track}-${level}-${existing?.id ?? "new"}`}
              label={`${tp(`tracks.${track}`)} · ${tp(`prizeLevel.${level}`)}`}
              initial={
                existing ?? { track, level, title: "", description: "", image_url: "", active: true }
              }
              disabled={!canEdit}
              onSave={(p) => void savePrize(p)}
            />
          );
        })}
      </section>
    </div>
  );
}

function NumberField({
  label,
  help,
  value,
  onChange,
  disabled,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-24" />
      <span className="block text-xs text-muted-foreground">{help}</span>
    </label>
  );
}

function AddGoal({
  options,
  onAdd,
}: {
  options: { key: string; label: string }[];
  onAdd: (metric: string, target: number) => void;
}) {
  const t = useTranslations("PlanSettings");
  const [metric, setMetric] = useState(options[0]?.key ?? "");
  const [target, setTarget] = useState("1");
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
      <div className="w-full max-w-64">
      <select value={metric} onChange={(e) => setMetric(e.target.value)} className={SELECT_CLASS} aria-label={t("metric")}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      </div>
      <Input
        type="number"
        min={1}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="h-8 w-20 text-right"
        aria-label={t("target")}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => onAdd(metric, Number(target))}>
        <Plus className="h-3.5 w-3.5" />
        {t("addGoal")}
      </Button>
    </div>
  );
}

function PrizeEditor({
  label,
  initial,
  disabled,
  onSave,
}: {
  label: string;
  initial: Prize;
  disabled: boolean;
  onSave: (p: Prize) => void;
}) {
  const t = useTranslations("PlanSettings");
  const [p, setP] = useState<Prize>(initial);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={p.active} disabled={disabled} onCheckedChange={(v: boolean) => setP({ ...p, active: v })} />
          {t("prizeActive")}
        </label>
      </div>
      <Input
        value={p.title}
        maxLength={80}
        disabled={disabled}
        onChange={(e) => setP({ ...p, title: e.target.value })}
        placeholder={t("prizeTitle")}
        aria-label={t("prizeTitle")}
      />
      <Input
        value={p.description}
        maxLength={300}
        disabled={disabled}
        onChange={(e) => setP({ ...p, description: e.target.value })}
        placeholder={t("prizeDescription")}
        aria-label={t("prizeDescription")}
      />
      <Input
        value={p.image_url}
        disabled={disabled}
        onChange={(e) => setP({ ...p, image_url: e.target.value })}
        placeholder={t("prizeImage")}
        aria-label={t("prizeImage")}
        inputMode="url"
      />
      {!disabled ? (
        <Button type="button" size="sm" onClick={() => onSave(p)}>
          <Save className="h-3.5 w-3.5" />
          {t("save")}
        </Button>
      ) : null}
    </div>
  );
}
