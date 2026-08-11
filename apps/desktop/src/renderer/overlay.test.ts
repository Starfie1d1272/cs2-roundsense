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
    finalAndPurchases: locale === "zh-CN"
      ? html.includes("最终配置") && html.includes("还要买")
      : html.includes("Final configuration") && html.includes("Still to buy"),
    exactSpendUnknown: locale === "zh-CN"
      ? html.includes("已花") && html.includes("未知")
      : html.includes("Spent") && html.includes("Unknown"),
    reliableConsequence: html.includes("$950"),
    internalEnumLeak: /\b(?:PRESERVE|LIGHT|FORCE|FULL)\b/.test(html),
  };
}

describe("overlay presentation contract", () => {
  it("keeps critical player language localized without leaking internal modes", () => {
    expect({ zhCN: contractSnapshot("zh-CN"), en: contractSnapshot("en") }).toMatchInlineSnapshot(`
      {
        "en": {
          "exactSpendUnknown": true,
          "finalAndPurchases": true,
          "internalEnumLeak": false,
          "playerMode": true,
          "reliableConsequence": true,
          "remainingBoundary": true,
        },
        "zhCN": {
          "exactSpendUnknown": true,
          "finalAndPurchases": true,
          "internalEnumLeak": false,
          "playerMode": true,
          "reliableConsequence": true,
          "remainingBoundary": true,
        },
      }
    `);
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
});
