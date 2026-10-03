// ============================================================
// El Plan — pure helpers (migration 048).
//
// Goals per league (advisor, broker, director) and period, daily
// activity counts, and how a day, week, month and quarter count as
// "cumplido". Everything here is pure so it can be unit-tested.
//
// Calendar rules (Mexico City time):
//   · weeks start on Monday;
//   · a day counts only if it is a workday of the account;
//   · a week is met when its own goals are met and enough of its
//     workdays were met (when there are daily goals);
//   · a month is met when its goals are met and enough of its weeks
//     (weeks whose Monday falls in the month) were met;
//   · a quarter is met when its goals are met and its three months
//     were met (when there are monthly goals).
// ============================================================

export const PLAN_TRACKS = ['advisor', 'broker', 'director'] as const
export type PlanTrack = (typeof PLAN_TRACKS)[number]

export const PLAN_PERIODS = ['day', 'week', 'month', 'quarter'] as const
export type PlanPeriod = (typeof PLAN_PERIODS)[number]

export type MetricSource = 'manual' | 'auto' | 'both'

export interface MetricDef {
  key: string
  /** Leagues that can use it. */
  tracks: PlanTrack[]
  /** How it gets counted. */
  source: MetricSource
  /** A manual entry must name a prospect. */
  needsContact: boolean
  /** Manual entry asks "¿contestó?" and also counts a conversation. */
  asksAnswered?: boolean
  /** Manual entry asks which team member (one-on-one). */
  needsMember?: boolean
  /** Manual entry asks for the post link and the resource used. */
  needsLink?: boolean
  /** Lucide icon name (resolved in the UI). */
  icon: string
}

export const METRICS: MetricDef[] = [
  { key: 'new_attempts', tracks: ['advisor', 'broker'], source: 'both', needsContact: true, asksAnswered: true, icon: 'PhoneOutgoing' },
  { key: 'conversations', tracks: ['advisor', 'broker'], source: 'both', needsContact: true, icon: 'MessagesSquare' },
  { key: 'followups', tracks: ['advisor', 'broker'], source: 'both', needsContact: true, asksAnswered: true, icon: 'RefreshCcw' },
  { key: 'social_posts', tracks: ['advisor', 'broker', 'director'], source: 'manual', needsContact: false, needsLink: true, icon: 'Megaphone' },
  { key: 'appointments_set', tracks: ['advisor', 'broker'], source: 'both', needsContact: true, icon: 'CalendarCheck' },
  { key: 'presentations', tracks: ['advisor', 'broker'], source: 'both', needsContact: true, icon: 'Presentation' },
  { key: 'quotes_sent', tracks: ['advisor', 'broker'], source: 'manual', needsContact: true, icon: 'FileText' },
  { key: 'referrals_asked', tracks: ['advisor', 'broker'], source: 'manual', needsContact: true, icon: 'UserPlus' },
  { key: 'prospects_registered', tracks: ['advisor', 'broker'], source: 'auto', needsContact: false, icon: 'Users' },
  { key: 'reservations', tracks: ['advisor', 'broker', 'director'], source: 'auto', needsContact: false, icon: 'KeyRound' },
  { key: 'sales', tracks: ['advisor', 'broker', 'director'], source: 'auto', needsContact: false, icon: 'Trophy' },
  { key: 'team_meetings', tracks: ['director'], source: 'manual', needsContact: false, icon: 'Users' },
  { key: 'one_on_ones', tracks: ['director'], source: 'manual', needsContact: false, needsMember: true, icon: 'UserCheck' },
  { key: 'networking_meetings', tracks: ['director'], source: 'manual', needsContact: false, icon: 'Handshake' },
  { key: 'broker_contacts', tracks: ['director'], source: 'manual', needsContact: false, icon: 'Contact' },
  { key: 'broker_agreements', tracks: ['director'], source: 'manual', needsContact: false, icon: 'FileSignature' },
  { key: 'accompanied_appointments', tracks: ['director'], source: 'manual', needsContact: true, icon: 'CalendarCheck' },
  { key: 'ads_reviews', tracks: ['director'], source: 'manual', needsContact: false, icon: 'BarChart3' },
  { key: 'partner_reports', tracks: ['director'], source: 'manual', needsContact: false, icon: 'FileBarChart' },
]

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(
  METRICS.map((m) => [m.key, m]),
)

/** Metrics a member of a league can register by hand. */
export function manualMetrics(track: PlanTrack): MetricDef[] {
  return METRICS.filter((m) => m.tracks.includes(track) && m.source !== 'auto')
}

/** Metrics a league can have goals for. */
export function trackMetrics(track: PlanTrack): MetricDef[] {
  return METRICS.filter((m) => m.tracks.includes(track))
}

export interface PlanGoal {
  id?: string
  track: PlanTrack
  period: PlanPeriod
  metric: string
  target: number
  sort_order: number
}

export interface PlanSettings {
  weekDaysRequired: number
  monthWeeksRequired: number
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  workdays: number[]
}

export const DEFAULT_SETTINGS: PlanSettings = {
  weekDaysRequired: 5,
  monthWeeksRequired: 3,
  workdays: [1, 2, 3, 4, 5, 6],
}

/** Counts per day (`YYYY-MM-DD`) and metric. */
export type DayCounts = Record<string, Record<string, number>>

// ------------------------------------------------------------
// Dates (plain `YYYY-MM-DD` strings, no time zone arithmetic)
// ------------------------------------------------------------

/** Today in Mexico City as `YYYY-MM-DD`. */
export function todayMx(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function toUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(day: string, n: number): string {
  const d = toUtc(day)
  d.setUTCDate(d.getUTCDate() + n)
  return fromUtc(d)
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  const w = toUtc(day).getUTCDay()
  return w === 0 ? 7 : w
}

export function weekStart(day: string): string {
  return addDays(day, 1 - isoWeekday(day))
}

export function monthStart(day: string): string {
  return `${day.slice(0, 8)}01`
}

export function monthEnd(day: string): string {
  const d = toUtc(monthStart(day))
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return fromUtc(d)
}

export function quarterStart(day: string): string {
  const m = Number(day.slice(5, 7))
  const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')
  return `${day.slice(0, 4)}-${qm}-01`
}

/** Inclusive list of days from `from` to `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

export function periodRange(period: PlanPeriod, today: string): { from: string; to: string } {
  switch (period) {
    case 'day':
      return { from: today, to: today }
    case 'week':
      return { from: weekStart(today), to: addDays(weekStart(today), 6) }
    case 'month':
      return { from: monthStart(today), to: monthEnd(today) }
    case 'quarter': {
      const qs = quarterStart(today)
      const third = monthStart(addDays(monthEnd(addDays(monthEnd(qs), 1)), 1))
      return { from: qs, to: monthEnd(third) }
    }
  }
}

// ------------------------------------------------------------
// Evaluation
// ------------------------------------------------------------

export interface GoalItem {
  /** Metric key, or a pseudo key: `days_met`, `weeks_met`, `months_met`. */
  key: string
  value: number
  target: number
  met: boolean
}

export interface PeriodResult {
  period: PlanPeriod
  from: string
  to: string
  items: GoalItem[]
  /** 0…1 average of each item's progress (capped at 1). */
  progress: number
  met: boolean
  /** Period has nothing to measure for this league. */
  empty: boolean
}

export function sumMetric(counts: DayCounts, days: string[], metric: string): number {
  let n = 0
  for (const d of days) n += counts[d]?.[metric] ?? 0
  return n
}

function goalsFor(goals: PlanGoal[], track: PlanTrack, period: PlanPeriod): PlanGoal[] {
  return goals
    .filter((g) => g.track === track && g.period === period)
    .sort((a, b) => a.sort_order - b.sort_order)
}

function result(period: PlanPeriod, from: string, to: string, items: GoalItem[]): PeriodResult {
  const progress = items.length
    ? items.reduce((s, i) => s + Math.min(1, i.target ? i.value / i.target : 1), 0) / items.length
    : 0
  return {
    period,
    from,
    to,
    items,
    progress,
    met: items.length > 0 && items.every((i) => i.met),
    empty: items.length === 0,
  }
}

function metricItems(goals: PlanGoal[], counts: DayCounts, days: string[]): GoalItem[] {
  return goals.map((g) => {
    const value = sumMetric(counts, days, g.metric)
    return { key: g.metric, value, target: g.target, met: value >= g.target }
  })
}

export interface Evaluator {
  day(day: string): PeriodResult
  week(anyDay: string): PeriodResult
  month(anyDay: string): PeriodResult
  quarter(anyDay: string): PeriodResult
}

/**
 * Evaluate a member's goals. `today` caps every period: days after
 * today don't exist yet, so a week in progress is judged on its
 * workdays so far plus the ones still ahead (they can still be met).
 */
export function evaluator(
  goals: PlanGoal[],
  track: PlanTrack,
  counts: DayCounts,
  settings: PlanSettings = DEFAULT_SETTINGS,
): Evaluator {
  const dayGoals = goalsFor(goals, track, 'day')
  const weekGoals = goalsFor(goals, track, 'week')
  const monthGoals = goalsFor(goals, track, 'month')
  const quarterGoals = goalsFor(goals, track, 'quarter')
  const isWork = (d: string) => settings.workdays.includes(isoWeekday(d))

  const day = (d: string): PeriodResult => {
    if (!isWork(d)) return result('day', d, d, [])
    return result('day', d, d, metricItems(dayGoals, counts, [d]))
  }

  const week = (anyDay: string): PeriodResult => {
    const from = weekStart(anyDay)
    const to = addDays(from, 6)
    const days = daysBetween(from, to)
    const items = metricItems(weekGoals, counts, days)
    if (dayGoals.length) {
      const workdays = days.filter(isWork)
      const required = Math.min(settings.weekDaysRequired, workdays.length)
      const metDays = workdays.filter((d) => day(d).met).length
      items.unshift({ key: 'days_met', value: metDays, target: required, met: metDays >= required })
    }
    return result('week', from, to, items)
  }

  const month = (anyDay: string): PeriodResult => {
    const from = monthStart(anyDay)
    const to = monthEnd(anyDay)
    const items = metricItems(monthGoals, counts, daysBetween(from, to))
    if (dayGoals.length || weekGoals.length) {
      const mondays = daysBetween(from, to).filter((d) => isoWeekday(d) === 1)
      const required = Math.min(settings.monthWeeksRequired, mondays.length)
      const metWeeks = mondays.filter((d) => week(d).met).length
      items.unshift({ key: 'weeks_met', value: metWeeks, target: required, met: metWeeks >= required })
    }
    return result('month', from, to, items)
  }

  const quarter = (anyDay: string): PeriodResult => {
    const { from, to } = periodRange('quarter', anyDay)
    const items = metricItems(quarterGoals, counts, daysBetween(from, to))
    if (monthGoals.length || weekGoals.length || dayGoals.length) {
      const starts = [from, addDays(monthEnd(from), 1), addDays(monthEnd(addDays(monthEnd(from), 1)), 1)]
      const metMonths = starts.filter((s) => month(s).met).length
      items.unshift({ key: 'months_met', value: metMonths, target: 3, met: metMonths >= 3 })
    }
    return result('quarter', from, to, items)
  }

  return { day, week, month, quarter }
}

/**
 * Consecutive workdays met, counting back from today. Today counts
 * when it's already met; otherwise the streak is still alive from
 * yesterday. Stops at `since` (the first day with data loaded).
 */
export function streak(ev: Evaluator, today: string, since: string, settings: PlanSettings = DEFAULT_SETTINGS): number {
  const isWork = (d: string) => settings.workdays.includes(isoWeekday(d))
  let d = today
  let n = 0
  if (!ev.day(today).met) d = addDays(today, -1)
  for (; d >= since; d = addDays(d, -1)) {
    if (!isWork(d)) continue
    const r = ev.day(d)
    if (r.empty) return n
    if (!r.met) break
    n++
  }
  return n
}

/** Workdays elapsed (including today) and total in a range. */
export function workdayProgress(from: string, to: string, today: string, settings: PlanSettings = DEFAULT_SETTINGS) {
  const days = daysBetween(from, to).filter((d) => settings.workdays.includes(isoWeekday(d)))
  return { elapsed: days.filter((d) => d <= today).length, total: days.length }
}

/** Linear projection of a count to the end of the range. */
export function project(value: number, elapsed: number, total: number): number {
  if (elapsed <= 0) return 0
  return Math.round((value / elapsed) * total * 10) / 10
}

/** Effective league of a member: explicit track, or one from the role. */
export function effectiveTrack(
  planTrack: string | null | undefined,
  role: string | null | undefined,
): PlanTrack | null {
  if (planTrack === 'none') return null
  if (planTrack === 'advisor' || planTrack === 'broker' || planTrack === 'director') return planTrack
  if (role === 'owner' || role === 'admin') return 'director'
  if (role === 'agent') return 'advisor'
  return null
}

/** Rows from `plan_counts()` into per-user DayCounts. */
export function groupCounts(
  rows: { user_id: string; day: string; metric: string; n: number }[],
): Record<string, DayCounts> {
  const out: Record<string, DayCounts> = {}
  for (const r of rows) {
    const u = (out[r.user_id] ??= {})
    const d = (u[r.day] ??= {})
    d[r.metric] = (d[r.metric] ?? 0) + Number(r.n)
  }
  return out
}

/** Funnel ratios for the director: step → next step, null when no base. */
export function funnel(counts: DayCounts, days: string[]) {
  const s = (m: string) => sumMetric(counts, days, m)
  const steps = [
    { key: 'new_attempts', value: s('new_attempts') },
    { key: 'conversations', value: s('conversations') },
    { key: 'appointments_set', value: s('appointments_set') },
    { key: 'presentations', value: s('presentations') },
    { key: 'reservations', value: s('reservations') },
  ]
  return steps.map((st, i) => ({
    ...st,
    rate: i === 0 || !steps[i - 1].value ? null : st.value / steps[i - 1].value,
  }))
}
