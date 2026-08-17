import { describe, expect, it } from "vitest";
import { DEMO_STATE } from "./demo-state.js";
import { renderOverlay } from "./overlay.js";

function contractSnapshot(locale: "zh-CN" | "en") {
  const state = structuredClone(DEMO_STATE);
  state.settings.locale = locale;
  const html = renderOverlay(state);
  return {
    playerMode: locale === "zh-CN" ? html.includes(">半起<") : html.includes(">Semi-buy<"),
    remainingBoundary: locale === "zh-CN" ? html.includes("还能花") : html.includes("Can still spend"),
    genericDefault: locale === "zh-CN"
      ? html.includes("默认最终配置") && html.includes("默认还要买")
      : html.includes("Default final configuration") && html.includes("Default items to buy"),
    exactSpendAbsent: locale === "zh-CN" ? !html.includes("已花") : !html.includes("Spent"),
    reliableConsequence: html.includes("$950"),
    internalEnumLeak: /\b(?:PRESERVE|LIGHT|FORCE|FULL)\b/.test(html),
  };
}

describe("overlay presentation contract", () => {
  it("keeps critical player language localized without leaking internal modes", () => {
    expect({ zhCN: contractSnapshot("zh-CN"), en: contractSnapshot("en") }).toEqual({
      zhCN: { playerMode: true, remainingBoundary: true, genericDefault: true, exactSpendAbsent: true, reliableConsequence: true, internalEnumLeak: false },
      en: { playerMode: true, remainingBoundary: true, genericDefault: true, exactSpendAbsent: true, reliableConsequence: true, internalEnumLeak: false },
    });
  });

  it("hides live state and does not render a fake plan for unsupported evidence", () => {
    const live = structuredClone(DEMO_STATE);
    live.product.phase = "live";
    live.product.visible = false;
    expect(renderOverlay(live)).toBe("");

    const unsupported = structuredClone(DEMO_STATE);
    unsupported.product.status = "unsupported";
    const html = renderOverlay(unsupported);
    expect(html).toContain("当前回合暂不提供购买建议");
    expect(html).not.toContain("$950");
  });

  it("keeps the half-buy consequence in compact mode but leaves a full buy compact", () => {
    const semi = structuredClone(DEMO_STATE);
    semi.settings.displayMode = "compact";
    expect(renderOverlay(semi)).toContain("$950");

    const full = structuredClone(DEMO_STATE);
    full.settings.displayMode = "compact";
    full.product.lockedMode = undefined;
    full.product.automaticMode = "full";
    full.product.automaticModes = ["full"];
    const html = renderOverlay(full);
    expect(html).not.toContain("默认最终配置");
    expect(html).not.toContain("$950");
  });
});
