"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Check,
  Clock,
  Flame,
  Gift,
  Lock,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ContactDetailView } from "@/components/contacts/contact-detail-view";
import { useProspectOwners } from "@/hooks/use-prospect-owners";
import { createClient } from "@/lib/supabase/client";
import { waPhone } from "@/lib/outreach/outreach";
import {
  METRIC_BY_KEY,
  PLAN_PERIODS,
  addDays,
  daysBetween,
  evaluator,
  isoWeekday,
  periodRange,
  project,
  streak,
  sumMetric,
  weekStart,
  workdayProgress,
  type GoalItem,
  type PeriodResult,
  type PlanPeriod,
  type PlanTrack,
} from "@/lib/plan/plan";
import {
  AMBER,
  Celebration,
  ProgressBar,
  ProgressRing,
  SAND,
  TEAL,
  MetricIcon,
} from "./plan-ui";
import { LogDialog, type LoggedResult } from "./log-dialog";
import type { PlanData, PlanPrize } from "./use-plan";

const PSEUDO = new Set(["days_met", "weeks_met", "months_met"]);

export function MyPlan({ data, accountId, userId }: { data: PlanData; accountId: string; userId: string }) {
  const t = useTranslations("Plan");
  const format = useFormatter();
  const { me, goals, settings, today, since, counts, prizes, members, recent, bump, reload } = data;
  const track = me?.track ?? null;
  const mine = useMemo(() => counts[userId] ?? {}, [counts, userId]);

  const ev = useMemo(
    () => (track ? evaluator(goals, track, mine, settings) : null),
    [goals, track, mine, settings],
  );

  const [logOpen, setLogOpen] = useState(false);
  const [logMetric, setLogMetric] = useState<string | null>(null);
  const [logKey, setLogKey] = useState(0);
  const [celebrate, setCelebrate] = useState<{ title: string; subtitle?: string } | null>(null);
  const [optIn, setOptIn] = useState(me?.plan_opt_in ?? true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [hour] = useState(() =>
    Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Mexico_City" }).format(
        new Date(),
      ),
    ),
  );
  const supabase = useMemo(() => createClient(), []);

  const openLog = (metric: string | null) => {
    setLogMetric(metric);
    setLogKey((k) => k + 1);
    setLogOpen(true);
  };

  const closeCelebration = useCallback(() => setCelebrate(null), []);

  if (!me || !track || !ev) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 font-medium">{t("noTrack")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("noTrackHint")}</p>
      </div>
    );
  }

  const periods = PLAN_PERIODS.map((p) => ({ p, r: ev[p](today) })).filter((x) => !x.r.empty);
  const ringPeriods = periods.slice(0, 3);
  const dayRes = ev.day(today);
  const hasDaily = goals.some((g) => g.track === track && g.period === "day");
  const streakDays = hasDaily ? streak(ev, today, since, settings) : 0;
  const firstName = me.full_name.split(/\s+/)[0] ?? "";

  const onSaved = (r: LoggedResult) => {
    setLogOpen(false);
    const before = evaluator(goals, track, mine, settings);
    const next = { ...mine, [r.day]: { ...(mine[r.day] ?? {}) } };
    for (const m of r.metrics) next[r.day][m] = (next[r.day][m] ?? 0) + 1;
    const after = evaluator(goals, track, next, settings);
    bump(r.metrics, r.day);
    void reload();

    const main = r.metrics[0];
    const label = t(`metrics.${main}`);
    // Smallest period that has a goal for this metric.
    const goalPeriod = PLAN_PERIODS.find((p) =>
      goals.some((g) => g.track === track && g.period === p && g.metric === main),
    );
    if (goalPeriod) {
      const item = (res: PeriodResult) => res.items.find((i) => i.key === main);
      const was = item(before[goalPeriod](r.day));
      const now = item(after[goalPeriod](r.day));
      if (now && was && !was.met && now.met) {
        toast.success(t("toast.goalMet", { metric: label, period: t(`periodOf.${goalPeriod}`) }));
      } else if (now && !now.met) {
        toast.success(
          t("toast.left", {
            metric: label,
            n: now.target - now.value,
            period: t(`periodOf.${goalPeriod}`),
          }),
        );
      } else {
        toast.success(t("toast.beyond", { metric: label, period: t(`periodOf.${goalPeriod}`) }));
      }
    } else {
      toast.success(t("toast.logged", { metric: label }));
    }

    const order: PlanPeriod[] = ["quarter", "month", "week", "day"];
    const won = order.find((p) => !before[p](r.day).met && after[p](r.day).met);
    if (won) {
      setCelebrate({
        title: t(`celebrate.${won}`),
        subtitle: won === "day" ? t("celebrate.streak", { n: streak(after, today, since, settings) }) : undefined,
      });
    }
  };

  const toggleOptIn = async (v: boolean) => {
    setOptIn(v);
    const { error } = await supabase.from("profiles").update({ plan_opt_in: v }).eq("user_id", userId);
    if (error) {
      setOptIn(!v);
      toast.error(t("saveFailed"));
    } else {
      toast.success(v ? t("optInOn") : t("optInOff"));
      void reload();
    }
  };

  const greet = hour < 12 ? "morning" : hour < 19 ? "afternoon" : "evening";

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-[#2C3B4E] p-5 text-[#EDE9DE] shadow-sm ring-1 ring-[#FEB161]/20 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border-[28px] border-[#FEB161]/[0.07]"
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[#EDE9DE]/60">
              {format.dateTime(new Date(`${today}T12:00:00-06:00`), {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              {" · "}
              {t(`tracks.${track}`)}
            </p>
            <h2 className="mt-1 font-serif text-2xl leading-tight sm:text-3xl">
              {t(`greet.${greet}`, { name: firstName })}
            </h2>
            <p className="mt-1 text-sm text-[#EDE9DE]/75">
              {dayRes.met
                ? t("hero.dayDone")
                : hasDaily
                  ? t("hero.dayLeft", { n: dayRes.items.filter((i) => !i.met).length })
                  : t("hero.results")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {hasDaily ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FEB161]/15 px-3 py-1 text-sm font-medium text-[#FEB161]">
                  <Flame className="h-4 w-4" aria-hidden />
                  {t("streak", { n: streakDays })}
                </span>
              ) : null}
              {dayRes.met ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1A9488]/25 px-3 py-1 text-sm font-medium text-[#EDE9DE]">
                  <Check className="h-4 w-4" aria-hidden />
                  {t("dayMet")}
                </span>
              ) : null}
              {track === "broker" ? (
                <label className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm">
                  <Switch checked={optIn} onCheckedChange={(v: boolean) => void toggleOptIn(v)} />
                  {t("optIn")}
                </label>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 sm:justify-start sm:gap-6">
            {ringPeriods.map(({ p, r }) => (
              <div key={p} className="flex flex-col items-center gap-1.5">
                <ProgressRing
                  value={r.progress}
                  color={r.met ? "#5FD3C6" : p === "day" ? AMBER : p === "week" ? SAND : "#9FB4CC"}
                  label={t("ringLabel", { period: t(`periods.${p}`), pct: Math.round(r.progress * 100) })}
                >
                  {r.met ? (
                    <Check className="h-6 w-6 text-[#5FD3C6]" aria-hidden />
                  ) : (
                    <span className="text-lg font-semibold tabular-nums">{Math.round(r.progress * 100)}%</span>
                  )}
                </ProgressRing>
                <span className="text-xs text-[#EDE9DE]/70">{t(`periods.${p}`)}</span>
              </div>
            ))}
          </div>
        </div>

        <Button
          type="button"
          onClick={() => openLog(null)}
          className="relative mt-5 h-12 w-full gap-2 rounded-xl bg-[#FEB161] text-base font-semibold text-[#2C3B4E] hover:bg-[#FEB161]/90 sm:w-auto sm:px-6"
        >
          <Plus className="h-5 w-5" />
          {t("logAction")}
        </Button>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <GoalsCard
            periods={periods.map((x) => x.p)}
            ev={ev}
            today={today}
            onAdd={openLog}
            track={track}
          />
          {hasDaily ? <Heatmap ev={ev} today={today} workdays={settings.workdays} /> : null}
          <RecentCard recent={recent} onDeleted={() => void reload()} today={today} onOpen={setDetailId} />
        </div>
        <div className="space-y-5">
          <PrizesCard prizes={prizes.filter((p) => p.track === track && p.active)} ev={ev} today={today} />
          <ForecastCard
            goals={goals.filter((g) => g.track === track && (g.period === "month" || g.period === "quarter"))}
            mine={mine}
            today={today}
            settings={settings}
          />
          <FollowupsCard
            accountId={accountId}
            userId={userId}
            days={data.followupDays}
            onLog={openLog}
            onOpen={setDetailId}
          />
        </div>
      </div>

      {logOpen ? (
        <LogDialog
          key={logKey}
          open
          initialMetric={logMetric}
          track={track}
          accountId={accountId}
          userId={userId}
          members={members}
          onClose={() => setLogOpen(false)}
          onSaved={onSaved}
        />
      ) : null}

      <ContactDetailView
        open={!!detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        contactId={detailId}
        onUpdated={() => void reload()}
      />

      {celebrate ? (
        <Celebration title={celebrate.title} subtitle={celebrate.subtitle} onDone={closeCelebration} />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------

function GoalsCard({
  periods,
  ev,
  today,
  onAdd,
  track,
}: {
  periods: PlanPeriod[];
  ev: ReturnType<typeof evaluator>;
  today: string;
  onAdd: (metric: string) => void;
  track: PlanTrack;
}) {
  const t = useTranslations("Plan");
  const [tab, setTab] = useState<PlanPeriod>(periods[0] ?? "day");
  const active = periods.includes(tab) ? tab : (periods[0] ?? "day");
  const res = ev[active](today);

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h3 className="font-serif text-lg">{t("goalsTitle")}</h3>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {periods.map((p) => {
            const r = ev[p](today);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active === p}
                onClick={() => setTab(p)}
                className={
                  "flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
              >
                {t(`periods.${p}`)}
                {r.met ? <Check className="h-3.5 w-3.5 text-[#1A9488]" aria-label={t("met")} /> : null}
              </button>
            );
          })}
        </div>
      </header>
      <ul className="divide-y divide-border">
        {res.items.map((item) => (
          <GoalRow key={item.key} item={item} track={track} onAdd={onAdd} />
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        {t(`periodRule.${active}`)}
      </p>
    </section>
  );
}

function GoalRow({ item, track, onAdd }: { item: GoalItem; track: PlanTrack; onAdd: (m: string) => void }) {
  const t = useTranslations("Plan");
  const def = METRIC_BY_KEY[item.key];
  const canAdd = !!def && def.source !== "auto" && def.tracks.includes(track);
  const auto = PSEUDO.has(item.key) ? null : def?.source === "auto" ? "auto" : def?.source === "both" ? "both" : null;

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span
        className={
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl " +
          (item.met ? "bg-[#1A9488]/15 text-[#1A9488]" : "bg-[#FEB161]/20 text-[#C98222]")
        }
      >
        {item.met ? <Check className="h-5 w-5" aria-hidden /> : <MetricIcon metric={item.key} className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{t(`metrics.${item.key}`)}</p>
          <p className="shrink-0 text-sm tabular-nums">
            <span className="font-semibold">{item.value}</span>
            <span className="text-muted-foreground"> / {item.target}</span>
          </p>
        </div>
        <ProgressBar value={item.target ? item.value / item.target : 0} met={item.met} className="mt-1.5" />
        {auto ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Zap className="h-3 w-3" aria-hidden />
            {t(`autoHint.${item.key}`)}
          </p>
        ) : null}
      </div>
      {canAdd ? (
        <button
          type="button"
          onClick={() => onAdd(item.key)}
          aria-label={t("addOne", { metric: t(`metrics.${item.key}`) })}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-[#C98222] hover:bg-[#FEB161]/15 active:scale-95"
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : (
        <span className="w-10 shrink-0" aria-hidden />
      )}
    </li>
  );
}

// ------------------------------------------------------------

function Heatmap({
  ev,
  today,
  workdays,
}: {
  ev: ReturnType<typeof evaluator>;
  today: string;
  workdays: number[];
}) {
  const t = useTranslations("Plan");
  const format = useFormatter();
  const start = addDays(weekStart(today), -28);
  const weeks = [0, 1, 2, 3, 4].map((w) => daysBetween(addDays(start, w * 7), addDays(start, w * 7 + 6)));
  const dayNames = weeks[0].map((d) =>
    format.dateTime(new Date(`${d}T12:00:00-06:00`), { weekday: "narrow" }),
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-serif text-lg">{t("heatmapTitle")}</h3>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-[3px] bg-muted" aria-hidden /> {t("heat.none")}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-[3px]" style={{ background: `${AMBER}99` }} aria-hidden /> {t("heat.partial")}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded-[3px]" style={{ background: TEAL }} aria-hidden /> {t("heat.met")}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="grid w-full max-w-[380px] grid-cols-[auto_repeat(7,minmax(0,1fr))] gap-1.5">
        <span />
        {dayNames.map((n, i) => (
          <span key={i} className="text-center text-[11px] uppercase text-muted-foreground">
            {n}
          </span>
        ))}
        {weeks.map((week) => {
          const wr = ev.week(week[0]);
          return [
            <span key={`w${week[0]}`} className="flex items-center pr-1 text-[11px] tabular-nums text-muted-foreground">
              {wr.met ? (
                <Check className="h-3.5 w-3.5 text-[#1A9488]" aria-label={t("met")} />
              ) : (
                format.dateTime(new Date(`${week[0]}T12:00:00-06:00`), { day: "numeric", month: "short" })
              )}
            </span>,
            ...week.map((d) => {
              const future = d > today;
              const work = workdays.includes(isoWeekday(d));
              const r = ev.day(d);
              const bg = future || !work ? "transparent" : r.met ? TEAL : r.progress > 0 ? AMBER : undefined;
              const alpha = r.met ? 1 : 0.25 + r.progress * 0.75;
              return (
                <span
                  key={d}
                  title={`${d} · ${work ? `${Math.round(r.progress * 100)}%` : t("heat.off")}`}
                  className={
                    "relative aspect-square rounded-md " +
                    (future ? "border border-dashed border-border" : !work ? "bg-[repeating-linear-gradient(135deg,var(--muted)_0_3px,transparent_3px_6px)]" : bg ? "" : "bg-muted") +
                    (d === today ? " ring-2 ring-[#C98222] ring-offset-1 ring-offset-card" : "")
                  }
                  style={bg && bg !== "transparent" ? { background: bg, opacity: alpha } : undefined}
                />
              );
            }),
          ];
        })}
      </div>
      <HeatStats ev={ev} weeks={weeks} today={today} workdays={workdays} />
      </div>
    </section>
  );
}

function HeatStats({
  ev,
  weeks,
  today,
  workdays,
}: {
  ev: ReturnType<typeof evaluator>;
  weeks: string[][];
  today: string;
  workdays: number[];
}) {
  const t = useTranslations("Plan");
  const days = weeks.flat().filter((d) => d <= today && workdays.includes(isoWeekday(d)));
  const metDays = days.filter((d) => ev.day(d).met).length;
  const metWeeks = weeks.filter((w) => w[0] <= today && ev.week(w[0]).met).length;
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (ev.day(d).met) best = Math.max(best, ++run);
    else if (d !== today) run = 0;
  }
  const stats = [
    { label: t("heat.daysMet"), value: `${metDays}/${days.length}` },
    { label: t("heat.weeksMet"), value: `${metWeeks}/${weeks.length}` },
    { label: t("heat.bestStreak"), value: String(best) },
  ];
  return (
    <dl className="grid flex-1 grid-cols-3 gap-3 sm:grid-cols-1">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl bg-muted/60 px-3 py-2.5">
          <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
          <dd className="font-serif text-2xl tabular-nums">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------

function PrizesCard({
  prizes,
  ev,
  today,
}: {
  prizes: PlanPrize[];
  ev: ReturnType<typeof evaluator>;
  today: string;
}) {
  const t = useTranslations("Plan");
  const ordered = PLAN_PERIODS.flatMap((p) => prizes.filter((x) => x.level === p));
  if (!ordered.length) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-serif text-lg">
        <Gift className="h-5 w-5 text-[#C98222]" aria-hidden />
        {t("prizesTitle")}
      </h3>
      <ul className="mt-3 space-y-3">
        {ordered.map((p) => {
          const r = ev[p.level](today);
          return (
            <li key={p.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start gap-3">
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#2C3B4E] text-[#FEB161]">
                    <Sparkles className="h-5 w-5" aria-hidden />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t(`prizeLevel.${p.level}`)}
                  </p>
                  <p className="font-medium leading-snug">{p.title}</p>
                  {p.description ? <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p> : null}
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <ProgressBar value={r.progress} met={r.met} />
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {r.met ? <Check className="ml-auto h-4 w-4 text-[#1A9488]" aria-label={t("met")} /> : `${Math.round(r.progress * 100)}%`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------

function ForecastCard({
  goals,
  mine,
  today,
  settings,
}: {
  goals: { period: PlanPeriod; metric: string; target: number }[];
  mine: Record<string, Record<string, number>>;
  today: string;
  settings: PlanData["settings"];
}) {
  const t = useTranslations("Plan");
  if (!goals.length) return null;
  const rows = goals.map((g) => {
    const { from, to } = periodRange(g.period, today);
    const wp = workdayProgress(from, to, today, settings);
    const value = sumMetric(mine, daysBetween(from, today), g.metric);
    const proj = project(value, wp.elapsed, wp.total);
    return { ...g, value, proj, onTrack: proj >= g.target };
  });
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-serif text-lg">
        <TrendingUp className="h-5 w-5 text-[#C98222]" aria-hidden />
        {t("forecastTitle")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("forecastHint")}</p>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={`${r.period}-${r.metric}`} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {t(`metrics.${r.metric}`)}
              <span className="text-muted-foreground"> · {t(`periods.${r.period}`)}</span>
            </span>
            <span
              className={
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums " +
                (r.onTrack ? "bg-[#1A9488]/15 text-[#1A9488]" : "bg-[#FEB161]/25 text-foreground")
              }
              title={t("forecastTooltip", { value: r.value, proj: r.proj, target: r.target })}
            >
              {t("forecastValue", { proj: r.proj, target: r.target })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------

interface FollowupRow {
  id: string;
  name: string | null;
  phone: string;
  owner_last_activity_at: string | null;
  owner_assigned_at: string | null;
}

function FollowupsCard({
  accountId,
  userId,
  days,
  onLog,
  onOpen,
}: {
  accountId: string;
  userId: string;
  days: number;
  onLog: (metric: string) => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("Plan");
  const { days: windowDays } = useProspectOwners();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<FollowupRow[] | null>(null);
  const [nowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const cutoff = new Date(nowMs - days * 86400000).toISOString();
    void supabase
      .from("contacts")
      .select("*")
      .eq("account_id", accountId)
      .eq("owner_id", userId)
      .or(`owner_last_activity_at.lt.${cutoff},owner_last_activity_at.is.null`)
      .order("owner_last_activity_at", { ascending: true, nullsFirst: true })
      .limit(8)
      .then(({ data, error }) => {
        if (!cancelled) setRows(error ? [] : ((data ?? []) as FollowupRow[]));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, userId, days, nowMs, supabase]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-serif text-lg">
        <Clock className="h-5 w-5 text-[#C98222]" aria-hidden />
        {t("followupsTitle")}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("followupsHint", { days })}</p>
      {rows === null ? (
        <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" />
      ) : rows.length === 0 ? (
        <p className="mt-3 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">{t("followupsEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const last = r.owner_last_activity_at ?? r.owner_assigned_at;
            const idle = last ? Math.floor((nowMs - new Date(last).getTime()) / 86400000) : null;
            const left = idle === null ? null : windowDays - idle;
            const digits = waPhone(r.phone);
            return (
              <li key={r.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                <button type="button" onClick={() => onOpen(r.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium hover:underline">{r.name || r.phone}</p>
                  <p className={"text-[11px] " + (left !== null && left <= 7 ? "text-[#C2553A]" : "text-muted-foreground")}>
                    {idle === null ? t("followupNever") : t("followupIdle", { n: idle })}
                    {left !== null && left <= 7 ? ` · ${t("followupExpires", { n: Math.max(0, left) })}` : ""}
                  </p>
                </button>
                {digits ? (
                  <a
                    href={`https://wa.me/${digits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("openWhatsapp")}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[#1A9488] hover:bg-[#1A9488]/10"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => onLog("followups")}
                  aria-label={t("addOne", { metric: t("metrics.followups") })}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border hover:border-[#C98222] hover:bg-[#FEB161]/15"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------

function RecentCard({
  recent,
  onDeleted,
  today,
  onOpen,
}: {
  recent: PlanData["recent"];
  onDeleted: () => void;
  today: string;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("Plan");
  const format = useFormatter();
  const supabase = useMemo(() => createClient(), []);
  const yesterday = addDays(today, -1);

  const remove = async (id: string) => {
    const { error } = await supabase.from("plan_activities").delete().eq("id", id);
    if (error) toast.error(t("deleteFailed"));
    else {
      toast.success(t("deleted"));
      onDeleted();
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card">
      <h3 className="border-b border-border px-4 py-3 font-serif text-lg sm:px-5">{t("recentTitle")}</h3>
      {recent.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t("recentEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {recent.map((a) => {
            const canDelete = a.source === "manual" && a.activity_day >= yesterday;
            return (
              <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                <MetricIcon metric={a.metric} className="mt-0.5 h-4 w-4 shrink-0 text-[#C98222]" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">
                    <span className="font-medium">{t(`metrics.${a.metric}`)}</span>
                    {a.contact ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => a.contact && onOpen(a.contact.id)}
                          className="hover:underline"
                        >
                          {a.contact.name || a.contact.phone}
                        </button>
                      </>
                    ) : null}
                    {a.outcome ? <span className="text-muted-foreground"> · {a.outcome}</span> : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {format.dateTime(new Date(a.occurred_at), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    {" · "}
                    {t(`sources.${a.source}`)}
                  </p>
                </div>
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => void remove(a.id)}
                    aria-label={t("deleteOne")}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
