// ============================================================
// Prospect ownership (migration 043) — pure, unit-testable.
//
// A prospect belongs to one advisor for `days` days counted from the
// later of the assignment and the owner's last activity. The database
// is the source of truth for visibility (RLS); this module only turns
// the same columns into something the UI can show: who owns it,
// whether the window is still open, and how many days are left.
// ============================================================

export const DEFAULT_OWNERSHIP_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OwnershipState = "none" | "active" | "expired";

export interface OwnershipColumns {
  owner_id?: string | null;
  owner_assigned_at?: string | null;
  owner_last_activity_at?: string | null;
}

export interface Ownership {
  state: OwnershipState;
  /** The owner on record — also set when the window has expired. */
  ownerId: string | null;
  expiresAt: Date | null;
  /** Whole days left, rounded up. 0 once expired, null when unowned. */
  daysLeft: number | null;
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function prospectOwnership(
  contact: OwnershipColumns,
  options: {
    days?: number;
    now?: Date;
    /** When given, an owner who is no longer a member counts as none. */
    memberIds?: ReadonlySet<string>;
  } = {},
): Ownership {
  const days =
    options.days && options.days > 0 ? options.days : DEFAULT_OWNERSHIP_DAYS;
  const now = (options.now ?? new Date()).getTime();
  const ownerId = contact.owner_id ?? null;

  if (!ownerId) {
    return { state: "none", ownerId: null, expiresAt: null, daysLeft: null };
  }
  if (options.memberIds && !options.memberIds.has(ownerId)) {
    return { state: "none", ownerId, expiresAt: null, daysLeft: null };
  }

  const starts = [
    toMs(contact.owner_assigned_at),
    toMs(contact.owner_last_activity_at),
  ].filter((x): x is number => x !== null);

  if (starts.length === 0) {
    // Owner without dates never happens through the app; the database
    // treats it as expired, so the UI does too.
    return { state: "expired", ownerId, expiresAt: null, daysLeft: 0 };
  }

  const expires = Math.max(...starts) + days * DAY_MS;
  if (expires <= now) {
    return { state: "expired", ownerId, expiresAt: new Date(expires), daysLeft: 0 };
  }
  return {
    state: "active",
    ownerId,
    expiresAt: new Date(expires),
    daysLeft: Math.ceil((expires - now) / DAY_MS),
  };
}

/**
 * ISO cut-off for "last activity older than the window". Contacts whose
 * `owner_last_activity_at` is before this have lapsed. Triggers always
 * stamp activity together with the assignment, so activity alone is
 * enough for list filters.
 */
export function ownershipCutoffIso(days = DEFAULT_OWNERSHIP_DAYS, now = new Date()): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}
