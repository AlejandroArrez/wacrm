"use client";

import { createElement, useEffect } from "react";
import {
  BarChart3,
  CalendarCheck,
  Contact,
  FileBarChart,
  FileSignature,
  FileText,
  Handshake,
  KeyRound,
  Megaphone,
  MessagesSquare,
  PhoneOutgoing,
  Presentation,
  RefreshCcw,
  Target,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";

import { METRIC_BY_KEY } from "@/lib/plan/plan";

/** Porta Magna brand. */
export const NAVY = "#2C3B4E";
export const AMBER = "#FEB161";
export const SAND = "#EDE9DE";
/** Amber dark enough for marks on a white card. */
export const AMBER_DEEP = "#C98222";
/** "Met" marks (always shown with a check icon too). */
export const TEAL = "#1A9488";

/**
 * Categorical series for charts. Validated for light and dark surfaces
 * (lightness band, chroma, CVD and contrast). Order is fixed.
 */
export const SERIES = ["#3E6FB0", "#C98222", "#1A9488", "#C2553A", "#7A5BB5"] as const;

const ICONS: Record<string, LucideIcon> = {
  PhoneOutgoing,
  MessagesSquare,
  RefreshCcw,
  Megaphone,
  CalendarCheck,
  Presentation,
  FileText,
  UserPlus,
  Users,
  KeyRound,
  Trophy,
  UserCheck,
  Handshake,
  Contact,
  FileSignature,
  BarChart3,
  FileBarChart,
};

const PSEUDO_ICONS: Record<string, LucideIcon> = {
  days_met: CalendarDays,
  weeks_met: CalendarDays,
  months_met: CalendarDays,
};

export function metricIcon(key: string): LucideIcon {
  return PSEUDO_ICONS[key] ?? ICONS[METRIC_BY_KEY[key]?.icon ?? ""] ?? Target;
}

/** Icon of a metric, as an element (keeps render free of dynamic components). */
export function MetricIcon({ metric, className }: { metric: string; className?: string }) {
  return createElement(metricIcon(metric), { className, "aria-hidden": true });
}

export function ProgressRing({
  value,
  size = 88,
  stroke = 9,
  color = AMBER,
  track = "rgba(237,233,222,0.16)",
  children,
  label,
}: {
  /** 0…1 */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label}
        className="-rotate-90"
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function ProgressBar({ value, met, className = "" }: { value: number; met?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={"h-2 w-full overflow-hidden rounded-full bg-muted " + className}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${v * 100}%`, background: met ? TEAL : AMBER_DEEP }}
      />
    </div>
  );
}

export function Initials({ name, className = "" }: { name: string; className?: string }) {
  const ini = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[#2C3B4E] font-semibold text-[#FEB161] " +
        className
      }
    >
      {ini || "·"}
    </span>
  );
}

/** Deterministic pseudo-random in [0, 1) (render must stay pure). */
function rand(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const CONFETTI = Array.from({ length: 48 }, (_, i) => ({
  left: rand(i, 1) * 100,
  delay: rand(i, 2) * 0.6,
  duration: 1.8 + rand(i, 3) * 1.4,
  size: 6 + Math.round(rand(i, 4) * 6),
  color: [AMBER, SAND, TEAL, "#ffffff", AMBER_DEEP][i % 5],
  rotate: Math.round(rand(i, 5) * 360),
  round: i % 3 === 0,
}));

/** Full-screen celebration. Closes itself; tap to close sooner. */
export function Celebration({
  title,
  subtitle,
  onDone,
}: {
  title: string;
  subtitle?: string;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 3800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onDone}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/30 backdrop-blur-[2px]"
    >
      <style>{`
        @keyframes pm-fall { 0% { transform: translate3d(0,-10vh,0) rotate(0deg); opacity: 1 }
          100% { transform: translate3d(0,105vh,0) rotate(540deg); opacity: .9 } }
        @keyframes pm-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.06); opacity: 1 }
          100% { transform: scale(1) } }
        @media (prefers-reduced-motion: reduce) { .pm-confetti { display: none } .pm-pop { animation: none !important } }
      `}</style>
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          aria-hidden
          className="pm-confetti pointer-events-none absolute top-0"
          style={{
            left: `${c.left}%`,
            width: c.size,
            height: c.round ? c.size : c.size * 0.45,
            background: c.color,
            borderRadius: c.round ? 999 : 2,
            transform: `rotate(${c.rotate}deg)`,
            animation: `pm-fall ${c.duration}s ${c.delay}s cubic-bezier(.2,.6,.4,1) forwards`,
          }}
        />
      ))}
      <div
        className="pm-pop mx-4 max-w-sm rounded-2xl bg-[#2C3B4E] px-8 py-7 text-center shadow-2xl ring-1 ring-[#FEB161]/40"
        style={{ animation: "pm-pop .5s ease-out both" }}
      >
        <Trophy className="mx-auto h-12 w-12 text-[#FEB161]" aria-hidden />
        <p className="mt-3 font-serif text-2xl text-[#EDE9DE]">{title}</p>
        {subtitle ? <p className="mt-1 text-sm text-[#EDE9DE]/75">{subtitle}</p> : null}
      </div>
    </div>
  );
}
