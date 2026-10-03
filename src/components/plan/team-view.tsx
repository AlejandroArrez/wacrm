"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Check, Crown, KanbanSquare, Medal, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "@/hooks/use-auth";
import { formatCurrencyShort } from "@/lib/currency";
import { createClient } from "@/lib/supabase/client";
import {
  PLAN_PERIODS,
  daysBetween,
  evaluator,
  funnel,
  periodRange,
  project,
  sumMetric,
  workdayProgress,
  type PlanPeriod,
  type PlanTrack,
} from "@/lib/plan/plan";
import { Initials, ProgressBar, SERIES, TEAL } from "./plan-ui";
import type { PlanData, PlanMember } from "./use-plan";

const FUNNEL = ["new_attempts", "conversations", "appointments_set", "presentations", "reservations"] as const;
const STATUS_COLOR = { met: TEAL, ok: TEAL, watch: "#C98222", behind: "#C2553A" } as const;
type Status = keyof typeof STATUS_COLOR;

interface Row {
  m: PlanMember;
  track: PlanTrack;
  progress: number;
  met: boolean;
  status: Status;
  values: Record<string, number>;
}

export function TeamView({ data }: { data: PlanData }) {
  const t = useTranslations("Plan");
  const { goals, settings, today, counts, members } = data;
  const [period, setPeriod] = useState<PlanPeriod>("week");

  const { from, to } = periodRange(period, today);
  const days = useMemo(() => daysBetween(from, today < to ? today : to), [from, to, today]);
  const wp = workdayProgress(from, to, today, settings);
  const pace = period === "day" ? 1 : wp.total ? wp.elapsed / wp.total : 1;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const m of members) {
      if (!m.track) continue;
      const mine = counts[m.user_id] ?? {};
      const ev = evaluator(goals, m.track, mine, settings);
      const r = ev[period](today);
      const ratio = r.progress / Math.max(pace, 0.15);
      const status: Status = r.met ? "met" : ratio >= 0.95 ? "ok" : ratio >= 0.6 ? "watch" : "behind";
      const values: Record<string, number> = {};
      for (const k of FUNNEL) values[k] = sumMetric(mine, days, k);
      out.push({ m, track: m.track, progress: r.empty ? 0 : r.progress, met: r.met, status, values });
    }
    return out;
  }, [members, counts, goals, settings, period, today, pace, days]);

  const sellers = rows.filter((r) => r.track !== "director" && r.m.plan_opt_in);
  const optedOut = rows.filter((r) => r.track === "broker" && !r.m.plan_opt_in);
  const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

  const totals = FUNNEL.map((k) => ({
    key: k,
    value: sellers.reduce((s, r) => s + r.values[k], 0),
  }));
  const teamCounts = useMemo(() => {
    const merged: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      if (r.track === "director") continue;
      for (const [d, mm] of Object.entries(counts[r.m.user_id] ?? {})) {
        const tgt = (merged[d] ??= {});
        for (const [k, v] of Object.entries(mm)) tgt[k] = (tgt[k] ?? 0) + v;
      }
    }
    return merged;
  }, [rows, counts]);
  const teamFunnel = funnel(teamCounts, days);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("team.paceNote", { elapsed: wp.elapsed, total: wp.total })}
        </p>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {PLAN_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
              }
            >
              {t(`periods.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {teamFunnel.map((f, i) => (
          <div key={f.key} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} aria-hidden />
              <p className="truncate text-xs text-muted-foreground">{t(`metrics.${f.key}`)}</p>
            </div>
            <p className="mt-1 font-serif text-3xl tabular-nums">{f.value}</p>
            <p className="text-[11px] text-muted-foreground">
              {f.rate === null ? " " : t("team.rateFromPrev", { pct: Math.round(f.rate * 100) })}
            </p>
          </div>
        ))}
      </div>

      {/* Traffic light */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h3 className="font-serif text-lg">{t("team.statusTitle")}</h3>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("team.empty")}</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <li
                key={r.m.user_id}
                className={
                  "flex items-center gap-3 rounded-xl border p-3 " +
                  (r.track === "broker" && !r.m.plan_opt_in ? "border-dashed border-border opacity-60" : "border-border")
                }
              >
                <Initials name={r.m.full_name} className="h-10 w-10 text-sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{r.m.full_name}</p>
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ color: STATUS_COLOR[r.status], background: `${STATUS_COLOR[r.status]}1f` }}
                    >
                      {r.status === "met" ? <Check className="h-3 w-3" aria-hidden /> : (
                        <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[r.status] }} aria-hidden />
                      )}
                      {t(`team.status.${r.status}`)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t(`tracks.${r.track}`)}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <ProgressBar value={r.progress} met={r.met} />
                    <span className="w-9 shrink-0 text-right text-xs tabular-nums">{Math.round(r.progress * 100)}%</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Bars */}
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 lg:col-span-3">
          <h3 className="font-serif text-lg">{t("team.barsTitle")}</h3>
          <Legend />
          {sellers.length ? (
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sellers.map((r) => ({ name: firstName(r.m.full_name), ...r.values }))}
                  barGap={2}
                  barCategoryGap="22%"
                  margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTip />} />
                  {FUNNEL.map((k, i) => (
                    <Bar key={k} dataKey={k} name={t(`metrics.${k}`)} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t("team.empty")}</p>
          )}
        </section>

        {/* Pie */}
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 lg:col-span-2">
          <h3 className="font-serif text-lg">{t("team.pieTitle")}</h3>
          {totals.some((x) => x.value > 0) ? (
            <>
              <div className="relative mt-2 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={totals.map((x) => ({ ...x, name: t(`metrics.${x.key}`) }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="88%"
                      paddingAngle={2}
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {totals.map((x, i) => (
                        <Cell key={x.key} fill={SERIES[i]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-serif text-3xl tabular-nums">{totals.reduce((s, x) => s + x.value, 0)}</span>
                  <span className="text-[11px] text-muted-foreground">{t("team.actions")}</span>
                </div>
              </div>
              <ul className="mt-2 space-y-1.5">
                {totals.map((x, i) => (
                  <li key={x.key} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} aria-hidden />
                    <span className="flex-1 text-muted-foreground">{t(`metrics.${x.key}`)}</span>
                    <span className="tabular-nums">{x.value}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t("team.noActivity")}</p>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Ranking rows={sellers.filter((r) => r.track === "advisor")} title={t("team.rankAdvisors")} />
        <Ranking
          rows={sellers.filter((r) => r.track === "broker")}
          title={t("team.rankBrokers")}
          footnote={optedOut.length ? t("team.optedOut", { n: optedOut.length }) : undefined}
        />
      </div>

      <FunnelTable rows={sellers} />

      <ForecastTable data={data} />

      <MiniKanban members={members} />
    </div>
  );
}

// ------------------------------------------------------------

function Legend() {
  const t = useTranslations("Plan");
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {FUNNEL.map((k, i) => (
        <li key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SERIES[i] }} aria-hidden />
          {t(`metrics.${k}`)}
        </li>
      ))}
    </ul>
  );
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; payload?: { fill?: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label ? <p className="mb-1 font-medium">{label}</p> : null}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} aria-hidden />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function Ranking({ rows, title, footnote }: { rows: Row[]; title: string; footnote?: string }) {
  const t = useTranslations("Plan");
  const sorted = [...rows].sort(
    (a, b) => b.progress - a.progress || b.values.reservations - a.values.reservations || b.values.presentations - a.values.presentations,
  );
  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-serif text-lg">
        <Crown className="h-5 w-5 text-[#C98222]" aria-hidden />
        {title}
      </h3>
      {sorted.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("team.noMembers")}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {sorted.map((r, i) => (
            <li key={r.m.user_id} className="flex items-center gap-3">
              <span
                className={
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
                  (i === 0 ? "bg-[#FEB161] text-[#2C3B4E]" : "bg-muted text-muted-foreground")
                }
                aria-label={t("team.place", { n: i + 1 })}
              >
                {i < 3 ? <Medal className="h-3.5 w-3.5" aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{r.m.full_name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("team.rankDetail", { p: r.values.presentations, a: r.values.reservations })}
              </span>
              <span className="w-10 text-right text-sm font-semibold tabular-nums">{Math.round(r.progress * 100)}%</span>
            </li>
          ))}
        </ol>
      )}
      {footnote ? <p className="mt-3 text-xs text-muted-foreground">{footnote}</p> : null}
    </section>
  );
}

function FunnelTable({ rows }: { rows: Row[] }) {
  const t = useTranslations("Plan");
  if (!rows.length) return null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <section className="rounded-2xl border border-border bg-card">
      <h3 className="border-b border-border px-4 py-3 font-serif text-lg sm:px-5">{t("team.funnelTitle")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium sm:px-5">{t("team.member")}</th>
              {FUNNEL.map((k) => (
                <th key={k} className="px-2 py-2 text-right font-medium">
                  {t(`metricsShort.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.m.user_id}>
                <td className="px-4 py-2.5 font-medium sm:px-5">{r.m.full_name}</td>
                {FUNNEL.map((k, i) => (
                  <td key={k} className="px-2 py-2.5 text-right tabular-nums">
                    <span className="font-semibold">{r.values[k]}</span>
                    {i > 0 ? (
                      <span className="block text-[11px] text-muted-foreground">
                        {pct(r.values[k], r.values[FUNNEL[i - 1]])}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">{t("team.funnelNote")}</p>
    </section>
  );
}

function ForecastTable({ data }: { data: PlanData }) {
  const t = useTranslations("Plan");
  const { members, goals, counts, today, settings } = data;
  const { from, to } = periodRange("month", today);
  const wp = workdayProgress(from, to, today, settings);
  const days = daysBetween(from, today);
  const rows = members
    .filter((m) => m.track && m.track !== "director" && m.plan_opt_in)
    .map((m) => {
      const mine = counts[m.user_id] ?? {};
      const cell = (metric: string) => {
        const goal = goals.find((g) => g.track === m.track && g.period === "month" && g.metric === metric);
        const value = sumMetric(mine, days, metric);
        return { value, proj: project(value, wp.elapsed, wp.total), target: goal?.target ?? null };
      };
      return { m, p: cell("presentations"), a: cell("reservations") };
    });
  if (!rows.length) return null;
  return (
    <section className="rounded-2xl border border-border bg-card">
      <h3 className="border-b border-border px-4 py-3 font-serif text-lg sm:px-5">{t("team.forecastTitle")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium sm:px-5">{t("team.member")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("metrics.presentations")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("metrics.reservations")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.m.user_id}>
                <td className="px-4 py-2.5 font-medium sm:px-5">{r.m.full_name}</td>
                <ForecastCell c={r.p} />
                <ForecastCell c={r.a} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        {t("team.forecastNote", { elapsed: wp.elapsed, total: wp.total })}
      </p>
    </section>
  );
}

function ForecastCell({ c }: { c: { value: number; proj: number; target: number | null } }) {
  const t = useTranslations("Plan");
  return (
    <td className="px-2 py-2.5 text-right tabular-nums">
      <span className="font-semibold">{c.proj}</span>
      {c.target !== null ? <span className="text-muted-foreground"> / {c.target}</span> : null}
      <span className="block text-[11px] text-muted-foreground">{t("team.soFar", { n: c.value })}</span>
    </td>
  );
}

// ------------------------------------------------------------

interface Stage {
  id: string;
  name: string;
  color: string | null;
  position: number;
  pipeline_id: string;
}
interface DealCard {
  id: string;
  title: string;
  value: number | null;
  stage_id: string;
  pipeline_id: string;
  assigned_to: string | null;
  contact: { name: string | null; phone: string } | null;
}

function MiniKanban({ members }: { members: PlanMember[] }) {
  const t = useTranslations("Plan");
  const { accountId, defaultCurrency } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<DealCard[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void Promise.all([
      supabase.from("pipelines").select("id, name").order("created_at"),
      supabase.from("pipeline_stages").select("id, name, color, position, pipeline_id").order("position"),
      supabase
        .from("deals")
        .select("id, title, value, stage_id, pipeline_id, assigned_to, contact:contacts(name, phone)")
        .eq("status", "open")
        .order("updated_at", { ascending: false })
        .limit(300),
    ]).then(([p, s, d]) => {
      if (cancelled) return;
      const pl = (p.data ?? []) as { id: string; name: string }[];
      const dl = ((d.data ?? []) as unknown as (DealCard & { contact: DealCard["contact"] | DealCard["contact"][] })[]).map(
        (x) => ({ ...x, contact: Array.isArray(x.contact) ? (x.contact[0] ?? null) : x.contact }),
      );
      setPipelines(pl);
      setStages((s.data ?? []) as Stage[]);
      setDeals(dl);
      // Default: the pipeline with the most open deals.
      const byCount = pl
        .map((x) => ({ id: x.id, n: dl.filter((y) => y.pipeline_id === x.id).length }))
        .sort((a, b) => b.n - a.n);
      setPipelineId(byCount[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const byProfile = new Map(members.map((m) => [m.id, m.full_name]));
  const cols = stages.filter((s) => s.pipeline_id === pipelineId);

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h3 className="flex items-center gap-2 font-serif text-lg">
          <KanbanSquare className="h-5 w-5 text-[#C98222]" aria-hidden />
          {t("team.kanbanTitle")}
        </h3>
        <div className="flex items-center gap-3">
          {pipelines.length > 1 ? (
            <select
              value={pipelineId ?? ""}
              onChange={(e) => setPipelineId(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              aria-label={t("team.pipeline")}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <Link
            href="/pipelines"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("team.openPipeline")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>
      {deals === null ? (
        <div className="m-5 h-40 animate-pulse rounded-xl bg-muted" />
      ) : cols.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t("team.noPipeline")}</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto p-4 sm:p-5">
          {cols.map((s) => {
            const items = deals.filter((d) => d.stage_id === s.id);
            const total = items.reduce((sum, d) => sum + (d.value ?? 0), 0);
            return (
              <div key={s.id} className="flex w-56 shrink-0 flex-col rounded-xl bg-muted/60 p-2">
                <div className="flex items-center gap-2 px-1.5 pb-2 pt-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color || "#64748b" }} aria-hidden />
                  <span className="flex-1 truncate text-sm font-medium">{s.name}</span>
                  <span className="rounded-full bg-background px-1.5 text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
                </div>
                {total > 0 ? (
                  <p className="px-1.5 pb-2 text-[11px] text-muted-foreground">{formatCurrencyShort(total, defaultCurrency)}</p>
                ) : null}
                <ul className="space-y-1.5">
                  {items.slice(0, 5).map((d) => {
                    const owner = d.assigned_to ? byProfile.get(d.assigned_to) : null;
                    return (
                      <li key={d.id} className="rounded-lg border border-border bg-card p-2.5 shadow-xs">
                        <p className="truncate text-sm font-medium">{d.title}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{d.contact?.name || d.contact?.phone || "—"}</p>
                        <div className="mt-1.5 flex items-center justify-between">
                          {owner ? (
                            <span className="flex min-w-0 items-center gap-1">
                              <Initials name={owner} className="h-5 w-5 text-[9px]" />
                              <span className="truncate text-[11px] text-muted-foreground">{owner.split(/\s+/)[0]}</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Users className="h-3 w-3" aria-hidden />
                              {t("team.unassigned")}
                            </span>
                          )}
                          {d.value ? (
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {formatCurrencyShort(d.value, defaultCurrency)}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                  {items.length > 5 ? (
                    <li className="px-1.5 text-[11px] text-muted-foreground">{t("team.more", { n: items.length - 5 })}</li>
                  ) : null}
                  {items.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
                      {t("team.emptyStage")}
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
