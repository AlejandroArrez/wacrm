import { describe, expect, it } from "vitest";
import {
  DEFAULT_OWNERSHIP_DAYS,
  ownershipCutoffIso,
  prospectOwnership,
} from "./ownership";

const now = new Date("2026-10-01T12:00:00Z");
const daysAgo = (d: number) =>
  new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe("prospectOwnership", () => {
  it("is none without an owner", () => {
    expect(prospectOwnership({ owner_id: null }, { now })).toEqual({
      state: "none",
      ownerId: null,
      expiresAt: null,
      daysLeft: null,
    });
  });

  it("is active inside the window and counts the days left", () => {
    const o = prospectOwnership(
      { owner_id: "u1", owner_assigned_at: daysAgo(20), owner_last_activity_at: daysAgo(10) },
      { now },
    );
    expect(o.state).toBe("active");
    expect(o.daysLeft).toBe(50);
  });

  it("uses the later of assignment and last activity", () => {
    const o = prospectOwnership(
      { owner_id: "u1", owner_assigned_at: daysAgo(5), owner_last_activity_at: daysAgo(59) },
      { now },
    );
    expect(o.daysLeft).toBe(55);
  });

  it("expires after the default 60 days", () => {
    expect(DEFAULT_OWNERSHIP_DAYS).toBe(60);
    const o = prospectOwnership(
      { owner_id: "u1", owner_assigned_at: daysAgo(90), owner_last_activity_at: daysAgo(61) },
      { now },
    );
    expect(o.state).toBe("expired");
    expect(o.daysLeft).toBe(0);
    expect(o.ownerId).toBe("u1");
  });

  it("honours a custom window", () => {
    const o = prospectOwnership(
      { owner_id: "u1", owner_last_activity_at: daysAgo(31) },
      { now, days: 30 },
    );
    expect(o.state).toBe("expired");
  });

  it("treats an owner without dates as expired, like the database", () => {
    expect(prospectOwnership({ owner_id: "u1" }, { now }).state).toBe("expired");
  });

  it("treats an owner who left the account as none", () => {
    const o = prospectOwnership(
      { owner_id: "gone", owner_last_activity_at: daysAgo(1) },
      { now, memberIds: new Set(["u1"]) },
    );
    expect(o.state).toBe("none");
  });
});

describe("ownershipCutoffIso", () => {
  it("is the window length before now", () => {
    expect(ownershipCutoffIso(60, now)).toBe(daysAgo(60));
  });
});
