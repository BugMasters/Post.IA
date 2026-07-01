import { describe, it, expect, vi } from "vitest";

const update = vi.fn((_a: unknown) => Promise.resolve({ id: "pp1" }));
vi.mock("@/infra/db/prisma", () => ({
  prisma: { positioningProfile: { update: (a: unknown) => update(a) } },
}));

import { updatePositioningProfile } from "../positioning.repository";

describe("updatePositioningProfile", () => {
  it("aplica patch parcial escopado por userId", async () => {
    await updatePositioningProfile("u1", { niche: "Dev backend" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (update.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.data).toEqual({ niche: "Dev backend" });
  });
});
