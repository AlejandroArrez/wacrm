import { describe, expect, it } from "vitest";
import { ADVISOR_SECTIONS, resolveSection } from "./settings-sections";

describe("resolveSection", () => {
  it("keeps the legacy mapping and default for admins", () => {
    expect(resolveSection(null)).toBe("overview");
    expect(resolveSection("tags")).toBe("fields");
    expect(resolveSection("whatsapp")).toBe("whatsapp");
  });

  it("sends advisors to their profile for any workspace section", () => {
    expect(resolveSection(null, ADVISOR_SECTIONS)).toBe("profile");
    expect(resolveSection("whatsapp", ADVISOR_SECTIONS)).toBe("profile");
    expect(resolveSection("members", ADVISOR_SECTIONS)).toBe("profile");
    expect(resolveSection("tags", ADVISOR_SECTIONS)).toBe("profile");
  });

  it("lets advisors open their own account sections", () => {
    expect(resolveSection("security", ADVISOR_SECTIONS)).toBe("security");
    expect(resolveSection("appearance", ADVISOR_SECTIONS)).toBe("appearance");
  });
});
