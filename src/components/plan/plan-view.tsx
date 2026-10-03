"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Settings2, Target, Users } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { MyPlan } from "./my-plan";
import { TeamView } from "./team-view";
import { usePlan } from "./use-plan";

type Tab = "mine" | "team";

export function PlanView() {
  const t = useTranslations("Plan");
  const { accountId, user } = useAuth();
  const seesAll = useCan("see-all-prospects");
  const canEdit = useCan("edit-settings");
  const data = usePlan();
  const [tab, setTab] = useState<Tab>("mine");

  const active: Tab = seesAll ? tab : "mine";

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canEdit ? (
          <Link
            href="/settings?tab=plan"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t("configure")}
          </Link>
        ) : null}
      </div>

      {seesAll ? (
        <div className="mt-5 inline-flex gap-1 rounded-lg bg-muted p-1">
          {(["mine", "team"] as const).map((k) => {
            const Icon = k === "mine" ? Target : Users;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active === k}
                onClick={() => setTab(k)}
                className={
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t(`tabs.${k}`)}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-5">
        {data.loading || !accountId || !user ? (
          <div className="space-y-4">
            <div className="h-56 animate-pulse rounded-2xl bg-muted" />
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="h-72 animate-pulse rounded-2xl bg-muted lg:col-span-2" />
              <div className="h-72 animate-pulse rounded-2xl bg-muted" />
            </div>
          </div>
        ) : data.failed ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">{t("loadFailed")}</p>
        ) : active === "team" ? (
          <TeamView data={data} />
        ) : (
          <MyPlan data={data} accountId={accountId} userId={user.id} />
        )}
      </div>
    </div>
  );
}
