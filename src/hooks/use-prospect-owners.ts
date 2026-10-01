"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_OWNERSHIP_DAYS } from "@/lib/prospects/ownership";
import { createClient } from "@/lib/supabase/client";
import type { AccountRole } from "@/lib/auth/roles";

export interface ProspectOwnerOption {
  user_id: string;
  full_name: string;
  email: string | null;
  role: AccountRole;
  advisor_code: string | null;
}

interface OwnersData {
  members: ProspectOwnerOption[];
  days: number;
}

// One fetch per account per page load. Members and the window length
// change rarely; the contact views read them many times.
const cache = new Map<string, Promise<OwnersData>>();

async function load(accountId: string): Promise<OwnersData> {
  const supabase = createClient();
  // `*` keeps both queries working if the app ships before
  // migration 043 adds advisor_code / prospect_ownership_days.
  const [membersRes, accountRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("account_id", accountId).order("full_name"),
    supabase.from("accounts").select("*").eq("id", accountId).maybeSingle(),
  ]);
  const members: ProspectOwnerOption[] = (membersRes.data ?? []).map(
    (p: Record<string, unknown>) => ({
      user_id: String(p.user_id),
      full_name: (p.full_name as string) || (p.email as string) || "",
      email: (p.email as string) ?? null,
      role: p.account_role as AccountRole,
      advisor_code: (p.advisor_code as string) ?? null,
    }),
  );
  const rawDays = Number(
    (accountRes.data as Record<string, unknown> | null)?.prospect_ownership_days,
  );
  return {
    members,
    days: Number.isFinite(rawDays) && rawDays > 0 ? rawDays : DEFAULT_OWNERSHIP_DAYS,
  };
}

/**
 * Members of the caller's account (for owner names and the assign
 * picker) and the ownership window length in days.
 */
export function useProspectOwners(): OwnersData & { loading: boolean } {
  const { accountId } = useAuth();
  const [data, setData] = useState<OwnersData | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    let p = cache.get(accountId);
    if (!p) {
      p = load(accountId);
      cache.set(accountId, p);
      // A failed load must not stick for the whole session.
      p.catch(() => cache.delete(accountId));
    }
    p.then((d) => {
      if (!cancelled) setData(d);
    }).catch(() => {
      if (!cancelled) setData({ members: [], days: DEFAULT_OWNERSHIP_DAYS });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return {
    members: data?.members ?? [],
    days: data?.days ?? DEFAULT_OWNERSHIP_DAYS,
    loading: data === null,
  };
}
