"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_SETTINGS,
  addDays,
  effectiveTrack,
  groupCounts,
  quarterStart,
  todayMx,
  type DayCounts,
  type PlanGoal,
  type PlanPeriod,
  type PlanSettings,
  type PlanTrack,
} from "@/lib/plan/plan";

export interface PlanMember {
  /** profiles.id (deals.assigned_to points here). */
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  role: AccountRole | null;
  plan_track: string | null;
  plan_opt_in: boolean;
  /** League after defaults (null = not in the plan). */
  track: PlanTrack | null;
}

export interface PlanPrize {
  id: string;
  track: PlanTrack;
  level: PlanPeriod;
  title: string;
  description: string | null;
  image_url: string | null;
  active: boolean;
}

export interface PlanActivity {
  id: string;
  user_id: string;
  metric: string;
  source: string;
  outcome: string | null;
  note: string | null;
  link: string | null;
  occurred_at: string;
  activity_day: string;
  contact: { id: string; name: string | null; phone: string } | null;
}

export interface PlanData {
  loading: boolean;
  failed: boolean;
  today: string;
  /** First day loaded into `counts`. */
  since: string;
  settings: PlanSettings;
  followupDays: number;
  goals: PlanGoal[];
  prizes: PlanPrize[];
  members: PlanMember[];
  me: PlanMember | null;
  /** Per user. Only the caller's own unless they see the whole team. */
  counts: Record<string, DayCounts>;
  recent: PlanActivity[];
  reload: () => Promise<void>;
  /** Optimistic +1 for the caller, before the reload lands. */
  bump: (metrics: string[], day?: string) => void;
}

function toMember(p: Record<string, unknown>): PlanMember {
  const role = isAccountRole(p.account_role) ? p.account_role : null;
  const planTrack = (p.plan_track as string | null) ?? null;
  return {
    id: String(p.id),
    user_id: String(p.user_id),
    full_name: (p.full_name as string) || (p.email as string) || "",
    avatar_url: (p.avatar_url as string) ?? null,
    role,
    plan_track: planTrack,
    plan_opt_in: p.plan_opt_in !== false,
    track: effectiveTrack(planTrack, role),
  };
}

export function usePlan(): PlanData {
  const { accountId, user } = useAuth();
  const userId = user?.id;
  const supabase = useMemo(() => createClient(), []);

  const [today, setToday] = useState(() => todayMx());
  const since = useMemo(() => {
    const back = addDays(today, -70);
    const qs = quarterStart(today);
    return qs < back ? qs : back;
  }, [today]);

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [settings, setSettings] = useState<PlanSettings>(DEFAULT_SETTINGS);
  const [followupDays, setFollowupDays] = useState(3);
  const [goals, setGoals] = useState<PlanGoal[]>([]);
  const [prizes, setPrizes] = useState<PlanPrize[]>([]);
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [counts, setCounts] = useState<Record<string, DayCounts>>({});
  const [recent, setRecent] = useState<PlanActivity[]>([]);

  const reload = useCallback(async () => {
    if (!accountId || !userId) return;
    const now = todayMx();
    setToday(now);
    const [accRes, goalsRes, prizesRes, membersRes, countsRes, recentRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("id", accountId).maybeSingle(),
      supabase
        .from("plan_goals")
        .select("id, track, period, metric, target, sort_order")
        .eq("account_id", accountId)
        .order("sort_order"),
      supabase
        .from("plan_prizes")
        .select("id, track, level, title, description, image_url, active")
        .eq("account_id", accountId),
      supabase.from("profiles").select("*").eq("account_id", accountId).order("full_name"),
      supabase.rpc("plan_counts", { p_account_id: accountId, p_from: since, p_to: now }),
      supabase
        .from("plan_activities")
        .select(
          "id, user_id, metric, source, outcome, note, link, occurred_at, activity_day, contact:contacts(id, name, phone)",
        )
        .eq("account_id", accountId)
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(15),
    ]);

    // The plan tables come with migration 048; without them the page
    // says so instead of rendering empty goals.
    setFailed(!!goalsRes.error || !!countsRes.error);

    const acc = accRes.data as Record<string, unknown> | null;
    if (acc) {
      const wd = Array.isArray(acc.plan_workdays) ? (acc.plan_workdays as number[]).map(Number) : null;
      setSettings({
        weekDaysRequired: Number(acc.plan_week_days_required) || DEFAULT_SETTINGS.weekDaysRequired,
        monthWeeksRequired: Number(acc.plan_month_weeks_required) || DEFAULT_SETTINGS.monthWeeksRequired,
        workdays: wd && wd.length ? wd : DEFAULT_SETTINGS.workdays,
      });
      setFollowupDays(Number(acc.plan_followup_days) || 3);
    }
    if (!goalsRes.error) setGoals((goalsRes.data ?? []) as PlanGoal[]);
    if (!prizesRes.error) setPrizes((prizesRes.data ?? []) as PlanPrize[]);
    if (!membersRes.error) {
      setMembers((membersRes.data ?? []).map((p) => toMember(p as Record<string, unknown>)));
    }
    if (!countsRes.error) {
      setCounts(
        groupCounts(
          (countsRes.data ?? []) as { user_id: string; day: string; metric: string; n: number }[],
        ),
      );
    }
    if (!recentRes.error) {
      setRecent(
        (recentRes.data ?? []).map((r) => {
          const row = r as unknown as PlanActivity & {
            contact: PlanActivity["contact"] | PlanActivity["contact"][];
          };
          return { ...row, contact: Array.isArray(row.contact) ? (row.contact[0] ?? null) : row.contact };
        }),
      );
    }
    setLoading(false);
  }, [accountId, userId, since, supabase]);

  useEffect(() => {
    // Fetch on mount; state is only set after the awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  // Activity also lands from other screens (inbox, pipeline, manual
  // outreach). Refresh when the tab comes back into view.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const bump = useCallback(
    (metrics: string[], day?: string) => {
      if (!userId) return;
      const d = day ?? todayMx();
      setCounts((prev) => {
        const mine = { ...(prev[userId] ?? {}) };
        const dayCounts = { ...(mine[d] ?? {}) };
        for (const m of metrics) dayCounts[m] = (dayCounts[m] ?? 0) + 1;
        mine[d] = dayCounts;
        return { ...prev, [userId]: mine };
      });
    },
    [userId],
  );

  const me = members.find((m) => m.user_id === userId) ?? null;

  return {
    loading,
    failed,
    today,
    since,
    settings,
    followupDays,
    goals,
    prizes,
    members,
    me,
    counts,
    recent,
    reload,
    bump,
  };
}
