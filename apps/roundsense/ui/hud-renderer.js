/* Shared HUD v2 renderer for both the live transparent overlay and Settings preview. */
(() => {
  'use strict';

  const ITEM_NAMES = {
    ak47: 'AK-47',
    m4a4: 'M4A4',
    m4a1s: 'M4A1-S',
    galil: 'Galil AR',
    famas: 'FAMAS',
    aug: 'AUG',
    sg553: 'SG 553',
    awp: 'AWP',
    ssg08: 'SSG 08',
    scar20: 'SCAR-20',
    g3sg1: 'G3SG1',
    mac10: 'MAC-10',
    mp9: 'MP9',
    mp7: 'MP7',
    mp5sd: 'MP5-SD',
    ump45: 'UMP-45',
    p90: 'P90',
    bizon: 'PP-Bizon',
    nova: 'Nova',
    xm1014: 'XM1014',
    mag7: 'MAG-7',
    sawedoff: 'Sawed-Off',
    m249: 'M249',
    negev: 'Negev',
    glock: 'Glock-18',
    usp: 'USP-S',
    p2000: 'P2000',
    p250: 'P250',
    dual: '双持贝瑞塔',
    tec9: 'Tec-9',
    cz75: 'CZ75-Auto',
    fiveseven: 'Five-SeveN',
    deagle: '沙漠之鹰',
    r8: 'R8 左轮',
    zeus: '电击枪',
    kevlar: '半甲',
    kevlar_helmet: '全甲',
    helmet_only: '升级头盔',
    defuse_kit: '拆弹器',
    smoke: '烟雾弹',
    flash: '闪光弹',
    he: '高爆手雷',
    molotov: '燃烧瓶',
    incendiary: '燃烧弹',
    decoy: '诱饵弹',
  };

  const ITEM_CATEGORY = {
    kevlar: 'eq',
    kevlar_helmet: 'eq',
    helmet_only: 'eq',
    defuse_kit: 'eq',
    smoke: 'util',
    flash: 'util',
    he: 'util',
    molotov: 'util',
    incendiary: 'util',
    decoy: 'util',
    zeus: 'util',
  };

  // CS2 player muscle-memory order: primary/secondary weapon -> armor -> kit -> smoke -> flash -> HE -> molly/inc -> decoy -> zeus
  const ITEM_DISPLAY_ORDER = {
    kevlar: 20,
    kevlar_helmet: 20,
    helmet_only: 21,
    defuse_kit: 30,
    smoke: 40,
    flash: 41,
    he: 42,
    molotov: 43,
    incendiary: 43,
    decoy: 44,
    zeus: 45,
  };

  const PISTOLS = new Set([
    'glock',
    'usp',
    'p2000',
    'p250',
    'dual',
    'tec9',
    'cz75',
    'fiveseven',
    'deagle',
    'r8',
  ]);

  function displayRank(purchase) {
    const key = purchase.helmetUpgradeOnly ? 'helmet_only' : purchase.item;
    if (Object.hasOwn(ITEM_DISPLAY_ORDER, key)) return ITEM_DISPLAY_ORDER[key];
    return PISTOLS.has(key) ? 10 : 0;
  }

  function sortPurchases(purchases) {
    return [...purchases].sort((a, b) => displayRank(a) - displayRank(b));
  }

  const MODE_NAMES = {
    FULL: '全起',
    FORCE: '强起',
    LIGHT: '半起',
    PRESERVE: 'ECO',
    AWP_PATH: '起 AWP',
  };

  const CAPABILITY_META = {
    RIFLE_ARMOR_BASIC_UTILITY: { text: '下局全起', cls: 'cap-full' },
    RIFLE_ARMOR: { text: '仅长枪甲', cls: 'cap-rifle' },
    INSUFFICIENT: { text: '长枪不足', cls: 'cap-low' },
    NOT_EVALUATED: { text: '未评估', cls: 'cap-muted' },
  };

  const formatMoney = (value) =>
    value === null || value === undefined ? '—' : '$' + Number(value).toLocaleString('en-US');

  function iconPathFor(item, helmetUpgradeOnly) {
    const key = helmetUpgradeOnly ? 'helmet_only' : item;
    if (!Object.prototype.hasOwnProperty.call(ITEM_NAMES, key)) return null;
    return '/assets/cs2/' + key + '.svg';
  }

  function createGearNode(purchase) {
    const key = purchase.helmetUpgradeOnly ? 'helmet_only' : purchase.item;
    const label = ITEM_NAMES[key] ?? purchase.item;
    const src = iconPathFor(purchase.item, purchase.helmetUpgradeOnly);
    const wrap = document.createElement('span');
    wrap.className = 'rs-gear-item';
    wrap.title = purchase.quantity > 1 ? label + ' ×' + purchase.quantity : label;

    if (purchase.helmetUpgradeOnly) {
      const plus = document.createElement('span');
      plus.className = 'rs-helm-plus';
      plus.textContent = '+';
      wrap.append(plus);
    }

    if (src) {
      const img = document.createElement('img');
      const cat = ITEM_CATEGORY[key] ?? 'gun';
      img.className = 'rs-icon rs-icon-' + cat;
      img.src = src;
      img.alt = label;
      img.decoding = 'async';
      wrap.append(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'rs-gear-fallback';
      fallback.textContent = label;
      wrap.append(fallback);
    }

    if (purchase.quantity > 1) {
      const qty = document.createElement('span');
      qty.className = 'rs-gear-qty';
      qty.textContent = '×' + purchase.quantity;
      wrap.append(qty);
    }

    return wrap;
  }

  const CONDITION_LABELS = {
    'T fourth utility slot': '第 4 格换双闪',
    'teammate lacks defuse kit': '若队友无钳',
    'if no teammate has a defuse kit': '若队友无钳',
  };

  function localizeCondition(raw) {
    if (!raw) return '条件替代';
    return CONDITION_LABELS[raw] ?? raw;
  }

  function createConditionalRow(alt) {
    const line = document.createElement('div');
    line.className = 'rs-cond-row';

    const condText = document.createElement('span');
    condText.className = 'rs-cond-text';
    condText.textContent = localizeCondition(alt.condition || alt.reason);
    line.append(condText);

    if (Array.isArray(alt.purchases) && alt.purchases.length > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'rs-cond-arrow';
      arrow.textContent = '→';
      line.append(arrow);

      const icons = document.createElement('span');
      icons.className = 'rs-cond-icons';
      for (const p of sortPurchases(alt.purchases)) {
        icons.append(createGearNode(p));
      }
      line.append(icons);
    }

    return line;
  }

  function renderHud(container, snapshot, options = {}) {
    if (!container) return;
    if (
      !snapshot ||
      snapshot.version !== 2 ||
      typeof snapshot.visible !== 'boolean' ||
      !snapshot.settings
    ) {
      throw new Error('Invalid HUD snapshot');
    }

    const forceShow = Boolean(options.forceShow);
    const shouldShow = forceShow || snapshot.visible;
    container.hidden = !shouldShow;

    if (!options.skipRootVars) {
      document.documentElement.style.setProperty(
        '--hud-opacity',
        String(snapshot.settings.opacity),
      );
      document.documentElement.style.setProperty('--hud-scale', String(snapshot.settings.scale));
    }

    if (!shouldShow) return;

    const contentKey = JSON.stringify({
      side: snapshot.side,
      round: snapshot.round,
      money: snapshot.money,
      roundContext: snapshot.roundContext,
      policyStatus: snapshot.policyStatus,
      unresolved: snapshot.unresolved,
      options: snapshot.options,
    });
    if (container.dataset.content === contentKey) return;
    container.dataset.content = contentKey;
    container.replaceChildren();

    const list = Array.isArray(snapshot.options) ? snapshot.options : [];
    const anchorParts = [];
    if (snapshot.side) anchorParts.push(snapshot.side);
    if (snapshot.round !== null && snapshot.round !== undefined)
      anchorParts.push('R' + snapshot.round);
    if (snapshot.money !== null && snapshot.money !== undefined)
      anchorParts.push(formatMoney(snapshot.money));
    const anchorText = anchorParts.join(' · ') || '冻结时间';

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rs-hud-empty';
      const title = document.createElement('strong');
      const desc = document.createElement('span');
      if (snapshot.policyStatus === 'UNSUPPORTED_POLICY_EVIDENCE') {
        title.textContent = snapshot.roundContext === 'PISTOL' ? '手枪局' : '特殊回合';
        desc.textContent = '暂不提供经济购买建议';
      } else {
        title.textContent = '信息不足';
        desc.textContent = '等待完整回合状态';
      }
      empty.append(title, desc);

      const foot = document.createElement('div');
      foot.className = 'rs-hud-foot';
      const left = document.createElement('span');
      left.textContent = anchorText;
      const right = document.createElement('span');
      right.textContent = '回合开始后自动隐藏';
      foot.append(left, right);

      container.append(empty, foot);
      return;
    }

    const header = document.createElement('div');
    header.className = 'rs-hud-head';
    const hMode = document.createElement('span');
    hMode.textContent = '策略';
    const hSpend = document.createElement('span');
    hSpend.textContent = '本局投入';
    const hNext = document.createElement('span');
    hNext.textContent = '败后现金';
    header.append(hMode, hSpend, hNext);
    container.append(header);

    for (const opt of list) {
      const row = document.createElement('section');
      row.className = opt.isDefault ? 'rs-opt rs-opt-default' : 'rs-opt';

      const top = document.createElement('div');
      top.className = 'rs-opt-top';

      const modeEl = document.createElement('div');
      modeEl.className = 'rs-opt-mode';
      if (opt.isDefault) {
        const dot = document.createElement('span');
        dot.className = 'rs-default-dot';
        dot.setAttribute('aria-label', '优先');
        modeEl.append(dot);
      }
      const modeLabel = document.createElement('span');
      modeLabel.textContent = MODE_NAMES[opt.mode] ?? opt.mode;
      modeEl.append(modeLabel);

      const hasBound =
        opt.maxSpendNow !== null &&
        opt.maxSpendNow !== undefined &&
        !(opt.mode === 'PRESERVE' && opt.spend === 0);
      const spendEl = document.createElement('div');
      spendEl.className = 'rs-opt-spend';
      spendEl.textContent = hasBound ? '≤ ' + formatMoney(opt.maxSpendNow) : formatMoney(opt.spend);

      const cap = CAPABILITY_META[opt.futureCapability] ?? CAPABILITY_META.NOT_EVALUATED;
      const nextEl = document.createElement('div');
      nextEl.className = 'rs-opt-next ' + cap.cls;
      const nextMain = document.createElement('span');
      nextMain.textContent = formatMoney(opt.lossNextMoney);
      nextEl.append(nextMain);

      if (
        snapshot.side === 'T' &&
        opt.lossWithPlantNextMoney !== null &&
        opt.lossWithPlantNextMoney !== undefined
      ) {
        const plantSub = document.createElement('span');
        plantSub.className = 'rs-opt-plant';
        plantSub.textContent = '+包 ' + formatMoney(opt.lossWithPlantNextMoney);
        nextEl.append(plantSub);
      }

      top.append(modeEl, spendEl, nextEl);
      row.append(top);

      const gearLine = document.createElement('div');
      gearLine.className = 'rs-opt-gear';

      const strip = document.createElement('div');
      strip.className = 'rs-gear-strip';
      if (Array.isArray(opt.purchases) && opt.purchases.length > 0) {
        for (const p of sortPurchases(opt.purchases)) {
          strip.append(createGearNode(p));
        }
        if (hasBound) {
          const actual = document.createElement('span');
          actual.className = 'rs-actual-spend';
          actual.textContent = '买 ' + formatMoney(opt.spend);
          strip.append(actual);
        }
      } else {
        const none = document.createElement('span');
        none.className = 'rs-gear-none';
        none.textContent = '无需购买';
        strip.append(none);
      }

      const capLabel = document.createElement('span');
      capLabel.className = 'rs-cap-label ' + cap.cls;
      capLabel.textContent = cap.text;

      gearLine.append(strip, capLabel);
      row.append(gearLine);

      if (Array.isArray(opt.conditionalAlternatives) && opt.conditionalAlternatives.length > 0) {
        for (const alt of opt.conditionalAlternatives) {
          row.append(createConditionalRow(alt));
        }
      }

      container.append(row);
    }

    const foot = document.createElement('div');
    foot.className = 'rs-hud-foot';
    const left = document.createElement('span');
    left.textContent = anchorText;
    const right = document.createElement('span');
    if (list.some((o) => o.lossNextMoney !== null && o.lossNextMoney !== undefined)) {
      right.textContent =
        snapshot.side === 'T' ? '败后未下包 · 无额外收入重买' : '败后按无额外收入重买';
    } else {
      right.textContent = '当前仅显示本局参考';
    }
    foot.append(left, right);
    container.append(foot);
  }

  window.RoundSenseHud = {
    render: renderHud,
    formatMoney,
    MODE_NAMES,
    ITEM_NAMES,
  };
})();
