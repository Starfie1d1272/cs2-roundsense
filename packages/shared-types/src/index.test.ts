import { describe, expect, it } from "vitest";
import {
  BOMB_EVENT_TYPES,
  C4_STATES,
  GSI_BOMB_STATES,
  NEXT_ROUND_GOALS,
  ROUND_TYPES,
  WEAPON_CLASSES,
} from "./index.js";

describe("shared-types", () => {
  it("exposes stable literal enums", () => {
    expect(ROUND_TYPES).toEqual(["pistol", "eco", "semi", "force", "full"]);
    expect(GSI_BOMB_STATES).toEqual(["planted", "exploding", "exploded", "defused", "dropped"]);
    expect(BOMB_EVENT_TYPES).toContain("planted");
    expect(BOMB_EVENT_TYPES).toContain("exploded");
    expect(C4_STATES).toContain("planted_unknown");
    expect(NEXT_ROUND_GOALS).toContain("awp");
    expect(WEAPON_CLASSES).toContain("rifle");
  });
});
