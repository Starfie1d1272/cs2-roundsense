import { DEFAULT_HUD_SETTINGS, type HudSettings } from "./model.js";
/** Full replacement; malformed or extra fields are rejected, never coerced. */
export function parseHudSettings(input: unknown): HudSettings | null {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return null;
  const x = input as Record<string, unknown>;
  if (Object.keys(x).some((key) => !Object.hasOwn(DEFAULT_HUD_SETTINGS, key)))
    return null;
  if (
    !["NEUTRAL", "PREFER", "SAVE_FOR_AWP"].includes(x.awpPriority as string) ||
    !["below-radar", "lower-left", "lower-right"].includes(
      x.position as string,
    ) ||
    typeof x.scale !== "number" ||
    !Number.isFinite(x.scale) ||
    x.scale < 0.8 ||
    x.scale > 1.5 ||
    typeof x.opacity !== "number" ||
    !Number.isFinite(x.opacity) ||
    x.opacity < 0.45 ||
    x.opacity > 0.95
  )
    return null;
  return {
    awpPriority: x.awpPriority as HudSettings["awpPriority"],
    position: x.position as HudSettings["position"],
    scale: x.scale,
    opacity: x.opacity,
  };
}
