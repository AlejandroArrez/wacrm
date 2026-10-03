import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  effectiveTrack,
  evaluator,
  funnel,
  groupCounts,
  isoWeekday,
  manualMetrics,
  monthEnd,
  periodRange,
  project,
  quarterStart,
  streak,
  todayMx,
  weekStart,
  workdayProgress,
  type DayCounts,
  type PlanGoal,
} from './plan'

const g = (period: PlanGoal['period'], metric: string, target: number, track: PlanGoal['track'] = 'advisor'): PlanGoal => ({
  track,
  period,
  metric,
  target,
  sort_order: 0,
})

describe('dates', () => {
  it('knows weekdays and week starts (Monday)', () => {
    expect(isoWeekday('2026-10-05')).toBe(1) // lunes
    expect(isoWeekday('2026-10-04')).toBe(7) // domingo
    expect(weekStart('2026-10-04')).toBe('2026-09-28')
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
  })
  it('handles month and quarter edges', () => {
    expect(monthEnd('2026-02-10')).toBe('2026-02-28')
    expect(monthEnd('2028-02-10')).toBe('2028-02-29')
    expect(quarterStart('2026-11-30')).toBe('2026-10-01')
    expect(periodRange('quarter', '2026-11-30')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('quarter', '2026-02-01')).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-10-01', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })
  it('uses Mexico City for today', () => {
    // 2026-10-03 03:00 UTC is still Oct 2 in CDMX (UTC-6)
    expect(todayMx(new Date('2026-10-03T03:00:00Z'))).toBe('2026-10-02')
    expect(todayMx(new Date('2026-10-03T07:00:00Z'))).toBe('2026-10-03')
  })
})

describe('effectiveTrack', () => {
  it('uses the explicit league first', () => {
    expect(effectiveTrack('broker', 'agent')).toBe('broker')
    expect(effectiveTrack('none', 'owner')).toBeNull()
  })
  it('falls back to the role', () => {
    expect(effectiveTrack(null, 'owner')).toBe('director')
    expect(effectiveTrack(null, 'admin')).toBe('director')
    expect(effectiveTrack(null, 'agent')).toBe('advisor')
    expect(effectiveTrack(null, 'viewer')).toBeNull()
  })
})

describe('manualMetrics', () => {
  it('never offers automatic-only metrics', () => {
    const keys = manualMetrics('advisor').map((m) => m.key)
    expect(keys).toContain('new_attempts')
    expect(keys).not.toContain('reservations')
    expect(keys).not.toContain('team_meetings')
    expect(manualMetrics('director').map((m) => m.key)).toContain('one_on_ones')
  })
})

describe('evaluator', () => {
  const goals = [g('day', 'new_attempts', 2), g('week', 'presentations', 1), g('month', 'reservations', 1)]
  const settings = { weekDaysRequired: 2, monthWeeksRequired: 1, workdays: [1, 2, 3, 4, 5] }

  it('meets a day only with all daily goals', () => {
    const counts: DayCounts = { '2026-10-05': { new_attempts: 2 }, '2026-10-06': { new_attempts: 1 } }
    const ev = evaluator(goals, 'advisor', counts, settings)
    expect(ev.day('2026-10-05').met).toBe(true)
    expect(ev.day('2026-10-06').met).toBe(false)
    expect(ev.day('2026-10-06').progress).toBe(0.5)
  })

  it('ignores non-workdays', () => {
    const ev = evaluator(goals, 'advisor', { '2026-10-04': { new_attempts: 9 } }, settings)
    expect(ev.day('2026-10-04').empty).toBe(true)
  })

  it('requires enough met days plus weekly goals for the week', () => {
    const counts: DayCounts = {
      '2026-10-05': { new_attempts: 2 },
      '2026-10-06': { new_attempts: 3, presentations: 1 },
    }
    const ev = evaluator(goals, 'advisor', counts, settings)
    const w = ev.week('2026-10-08')
    expect(w.items[0]).toMatchObject({ key: 'days_met', value: 2, target: 2, met: true })
    expect(w.met).toBe(true)
    const ev2 = evaluator(goals, 'advisor', { '2026-10-05': { new_attempts: 2, presentations: 1 } }, settings)
    expect(ev2.week('2026-10-05').met).toBe(false)
  })

  it('requires met weeks plus monthly goals for the month', () => {
    const counts: DayCounts = {
      '2026-10-05': { new_attempts: 2 },
      '2026-10-06': { new_attempts: 2, presentations: 1 },
      '2026-10-20': { reservations: 1 },
    }
    const ev = evaluator(goals, 'advisor', counts, settings)
    const m = ev.month('2026-10-01')
    expect(m.items.find((i) => i.key === 'weeks_met')).toMatchObject({ value: 1, target: 1 })
    expect(m.met).toBe(true)
  })

  it('judges brokers on results only', () => {
    const brokerGoals = [g('month', 'prospects_registered', 2, 'broker'), g('quarter', 'reservations', 1, 'broker')]
    const ev = evaluator([...goals, ...brokerGoals], 'broker', { '2026-10-02': { prospects_registered: 2 } })
    expect(ev.day('2026-10-02').empty).toBe(true)
    const m = ev.month('2026-10-02')
    expect(m.items.map((i) => i.key)).toEqual(['prospects_registered'])
    expect(m.met).toBe(true)
  })

  it('needs the three months for the quarter', () => {
    const q = evaluator(goals, 'advisor', {}, settings).quarter('2026-11-15')
    expect(q.items[0]).toMatchObject({ key: 'months_met', target: 3, value: 0 })
    expect(q.met).toBe(false)
  })
})

describe('streak', () => {
  const goals = [g('day', 'new_attempts', 1)]
  const settings = { weekDaysRequired: 5, monthWeeksRequired: 3, workdays: [1, 2, 3, 4, 5] }
  it('counts met workdays back, skipping weekends, and survives an open today', () => {
    const counts: DayCounts = {
      '2026-10-01': { new_attempts: 1 }, // jue
      '2026-10-02': { new_attempts: 1 }, // vie
      // sáb y dom no cuentan
    }
    const ev = evaluator(goals, 'advisor', counts, settings)
    expect(streak(ev, '2026-10-05', '2026-09-01', settings)).toBe(2) // lunes aún abierto
    const ev2 = evaluator(goals, 'advisor', { ...counts, '2026-10-05': { new_attempts: 1 } }, settings)
    expect(streak(ev2, '2026-10-05', '2026-09-01', settings)).toBe(3)
  })
  it('is zero without daily goals', () => {
    const ev = evaluator([], 'advisor', {}, settings)
    expect(streak(ev, '2026-10-05', '2026-09-01', settings)).toBe(0)
  })
})

describe('progress helpers', () => {
  it('projects linearly over workdays', () => {
    const wp = workdayProgress('2026-10-01', '2026-10-31', '2026-10-10')
    expect(wp.total).toBe(27) // lunes a sábado de octubre 2026
    expect(wp.elapsed).toBe(9)
    expect(project(3, 9, 27)).toBe(9)
    expect(project(3, 0, 27)).toBe(0)
  })
  it('groups rpc rows and computes funnel rates', () => {
    const grouped = groupCounts([
      { user_id: 'a', day: '2026-10-01', metric: 'new_attempts', n: 10 },
      { user_id: 'a', day: '2026-10-02', metric: 'conversations', n: 4 },
      { user_id: 'b', day: '2026-10-02', metric: 'new_attempts', n: 1 },
    ])
    expect(grouped.a['2026-10-01'].new_attempts).toBe(10)
    const f = funnel(grouped.a, ['2026-10-01', '2026-10-02'])
    expect(f[0].rate).toBeNull()
    expect(f[1].rate).toBe(0.4)
    expect(f[2].rate).toBe(0)
    expect(f[3].rate).toBeNull()
  })
})
