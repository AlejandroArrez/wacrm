"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  FINAL_RESULTS,
  MESSAGE_MAX,
  fillTemplate,
  isDailyLimitError,
  rankTemplates,
  waPhone,
  whatsappLink,
  type OpenWith,
  type OutreachQueueRow,
  type OutreachResult,
  type OutreachTemplate,
} from "@/lib/outreach/outreach";
import { SELECT_CLASS } from "@/components/resources/resource-dialog";

const OPEN_WITH_KEY = "strato.outreach.openWith";

function readOpenWith(): OpenWith {
  try {
    return localStorage.getItem(OPEN_WITH_KEY) === "web" ? "web" : "app";
  } catch {
    return "app";
  }
}

export interface Quota {
  used: number;
  limit: number;
}

export function OutreachDialog({
  row,
  accountId,
  templates,
  advisorName,
  advisorPhone,
  quota,
  onClose,
  onChanged,
}: {
  row: OutreachQueueRow | null;
  accountId: string;
  templates: OutreachTemplate[];
  advisorName: string | null;
  advisorPhone: string | null;
  quota: Quota | null;
  onClose: () => void;
  /** An attempt was registered or its result changed. */
  onChanged: () => void;
}) {
  const t = useTranslations("Outreach");
  const supabase = useMemo(() => createClient(), []);

  const ranked = useMemo(
    () => (row ? rankTemplates(templates, row.tags) : []),
    [row, templates],
  );
  // The parent keys this component by prospect, so every prospect
  // starts from fresh state.
  const [templateId, setTemplateId] = useState<string>(() => ranked[0]?.id ?? "");
  const [text, setText] = useState(() =>
    row && ranked[0]
      ? fillTemplate(ranked[0].body, { contactName: row.name, advisorName, advisorPhone })
      : "",
  );
  const [openWith, setOpenWith] = useState<OpenWith>(readOpenWith);
  const [step, setStep] = useState<"compose" | "result">("compose");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!row) return null;

  const digits = waPhone(row.phone_normalized ?? row.phone);
  const atLimit = !!quota && quota.used >= quota.limit;

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (tpl) {
      setText(
        fillTemplate(tpl.body, {
          contactName: row.name,
          advisorName,
          advisorPhone,
        }),
      );
    }
  };

  const changeOpenWith = (v: OpenWith) => {
    setOpenWith(v);
    try {
      localStorage.setItem(OPEN_WITH_KEY, v);
    } catch {
      /* per-device preference only */
    }
  };

  const send = async () => {
    const message = text.trim();
    if (!digits || !message) return;
    const link = whatsappLink(digits, message, openWith);
    // Open the tab inside the click so the browser doesn't block it;
    // point it at WhatsApp once the attempt is recorded.
    const win = window.open("", "_blank");
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("outreach_attempts")
        .insert({
          account_id: accountId,
          contact_id: row.contact_id,
          template_id: templateId || null,
          message,
        })
        .select("id")
        .single();
      if (error || !data) {
        win?.close();
        toast.error(isDailyLimitError(error) ? t("limitReached") : t("saveFailed"));
        return;
      }
      if (win) {
        win.opener = null;
        win.location.href = link;
      } else {
        setFallbackLink(link);
      }
      setAttemptId(data.id as string);
      setStep("result");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const setResult = async (result: OutreachResult) => {
    const id = attemptId ?? row.last_attempt_id;
    if (!id) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("outreach_attempts")
        .update({ result })
        .eq("id", id);
      if (error) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("resultSaved"));
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "compose" ? t("dialogTitle") : t("resultTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <p className="font-medium text-foreground">{row.name || t("noName")}</p>
          <p className="text-xs text-muted-foreground">{row.phone}</p>
        </div>

        {step === "compose" ? (
          <div className="space-y-3">
            {!advisorPhone ? (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>
                  {t("noPhoneWarning")}{" "}
                  <Link href="/settings?tab=profile" className="underline">
                    {t("noPhoneLink")}
                  </Link>
                </span>
              </p>
            ) : null}
            {!digits ? (
              <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-foreground">
                {t("badNumber")}
              </p>
            ) : null}

            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t("templateLabel")}</p>
              {ranked.length ? (
                <select
                  className={SELECT_CLASS}
                  value={templateId}
                  onChange={(e) => pickTemplate(e.target.value)}
                >
                  {ranked.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">{t("noTemplates")}</p>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t("messageLabel")}</p>
              <Textarea
                value={text}
                maxLength={MESSAGE_MAX}
                onChange={(e) => setText(e.target.value)}
                className="min-h-36"
                placeholder={t("messagePlaceholder")}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t("messageHelp")}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-xs">
                {(["app", "web"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={openWith === v}
                    onClick={() => changeOpenWith(v)}
                    className={
                      "rounded-md px-2.5 py-1 font-medium transition-colors " +
                      (openWith === v
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {v === "app" ? t("openApp") : t("openWeb")}
                  </button>
                ))}
              </div>
              {quota ? (
                <span className={"text-xs " + (atLimit ? "text-red-400" : "text-muted-foreground")}>
                  {t("quota", { used: quota.used, limit: quota.limit })}
                </span>
              ) : null}
            </div>

            <Button
              className="w-full"
              onClick={send}
              disabled={busy || !digits || !text.trim() || atLimit}
            >
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="mr-1 h-4 w-4" />
              )}
              {atLimit ? t("limitReached") : t("openWhatsApp")}
            </Button>

            {row.last_attempt_id && row.last_result === "sent" ? (
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs text-muted-foreground">{t("previousPending")}</p>
                <ResultButtons busy={busy} onPick={setResult} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("resultHelp")}</p>
            {fallbackLink ? (
              <a
                href={fallbackLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline"
              >
                <ExternalLink className="h-4 w-4" />
                {t("openAgain")}
              </a>
            ) : null}
            <ResultButtons busy={busy} onPick={setResult} />
            <Button variant="ghost" className="w-full" onClick={onClose}>
              {t("decideLater")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResultButtons({
  busy,
  onPick,
}: {
  busy: boolean;
  onPick: (r: OutreachResult) => void;
}) {
  const t = useTranslations("Outreach");
  return (
    <div className="grid grid-cols-2 gap-2">
      {FINAL_RESULTS.map((r) => (
        <Button key={r} variant="outline" disabled={busy} onClick={() => onPick(r)}>
          {t(`results.${r}`)}
        </Button>
      ))}
    </div>
  );
}
