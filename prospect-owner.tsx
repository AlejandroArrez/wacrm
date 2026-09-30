"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, RefreshCw, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCan } from "@/hooks/use-can";
import { useProspectOwners } from "@/hooks/use-prospect-owners";
import {
  prospectOwnership,
  type OwnershipColumns,
} from "@/lib/prospects/ownership";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NONE = "__none__";

function useOwnership(contact: OwnershipColumns) {
  const { members, days } = useProspectOwners();
  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);
  const ownership = prospectOwnership(contact, {
    days,
    memberIds: members.length > 0 ? memberIds : undefined,
  });
  const owner = members.find((m) => m.user_id === ownership.ownerId) ?? null;
  return { ownership, owner, members, days };
}

/** One-line status for tables: owner and days left, or no owner. */
export function ProspectOwnerBadge({
  contact,
  className,
}: {
  contact: OwnershipColumns;
  className?: string;
}) {
  const t = useTranslations("Prospects");
  const seesAll = useCan("see-all-prospects");
  const { ownership, owner } = useOwnership(contact);

  if (ownership.state === "none") {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>{t("noOwner")}</span>
    );
  }
  if (ownership.state === "expired") {
    return (
      <span className={cn("text-xs text-amber-600 dark:text-amber-400", className)}>
        {owner ? t("expiredOf", { name: owner.full_name }) : t("expired")}
      </span>
    );
  }
  const warn = (ownership.daysLeft ?? 0) <= 7;
  return (
    <span className={cn("text-xs", warn ? "text-amber-600 dark:text-amber-400" : "text-foreground", className)}>
      {seesAll && owner ? `${owner.full_name} · ` : ""}
      {t("daysLeft", { days: ownership.daysLeft ?? 0 })}
    </span>
  );
}

/**
 * Owner block for the contact detail and the inbox sidebar. Everyone
 * sees who owns the prospect and until when; admins can assign it,
 * take it back or renew the window.
 */
export function ProspectOwnerPanel({
  contactId,
  contact,
  onChanged,
}: {
  contactId: string;
  contact: OwnershipColumns;
  onChanged?: (next: OwnershipColumns) => void;
}) {
  const t = useTranslations("Prospects");
  const locale = useLocale();
  const canAssign = useCan("assign-prospects");
  const [current, setCurrent] = useState<OwnershipColumns>(contact);
  const [busy, setBusy] = useState(false);

  // Follow the parent when it switches to another contact.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrent({
      owner_id: contact.owner_id ?? null,
      owner_assigned_at: contact.owner_assigned_at ?? null,
      owner_last_activity_at: contact.owner_last_activity_at ?? null,
    });
  }, [contactId, contact.owner_id, contact.owner_assigned_at, contact.owner_last_activity_at]);

  const { ownership, owner, members } = useOwnership(current);
  const advisors = members.filter((m) => m.role === "agent");

  async function assign(ownerId: string | null) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_prospect_owner", {
      p_contact_id: contactId,
      p_owner_id: ownerId,
    });
    if (error) {
      setBusy(false);
      toast.error(t("assignFailed"));
      return;
    }
    const { data } = await supabase
      .from("contacts")
      .select("owner_id, owner_assigned_at, owner_last_activity_at")
      .eq("id", contactId)
      .maybeSingle();
    setBusy(false);
    const next: OwnershipColumns = data ?? { owner_id: ownerId };
    setCurrent(next);
    onChanged?.(next);
    toast.success(ownerId ? t("assigned") : t("unassigned"));
  }

  const status =
    ownership.state === "none"
      ? t("noOwnerLong")
      : ownership.state === "expired"
        ? t("expiredLong", { name: owner?.full_name ?? "—" })
        : t("activeLong", {
            name: owner?.full_name ?? "—",
            days: ownership.daysLeft ?? 0,
            date: ownership.expiresAt?.toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
            }) ?? "",
          });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <UserRound className="h-3 w-3" />
        {t("title")}
      </div>
      <p
        className={cn(
          "px-1 text-sm",
          ownership.state === "active" ? "text-foreground" : "text-amber-600 dark:text-amber-400",
        )}
      >
        {status}
      </p>

      {canAssign && (
        <div className="flex items-center gap-2 px-1">
          <Select
            value={ownership.state === "active" && ownership.ownerId ? ownership.ownerId : NONE}
            onValueChange={(v) => {
              if (!v) return;
              void assign(v === NONE ? null : v);
            }}
          >
            <SelectTrigger className="h-8 flex-1 bg-muted border-border text-foreground" disabled={busy}>
              <SelectValue>
                {ownership.state === "active" && owner ? owner.full_name : t("pickOwner")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t("noOwner")}</SelectItem>
              {advisors.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name}
                  {m.advisor_code ? ` · ${m.advisor_code}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ownership.ownerId && ownership.state !== "none" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void assign(ownership.ownerId)}
              title={t("renewHelp")}
              className="h-8 border-border"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {t("renew")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
