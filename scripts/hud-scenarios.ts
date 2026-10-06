/** Local visual QA: synthetic normal-player GSI enters the real receiver. */
import { createServer } from "node:http";
import type { GsiPayload } from "../packages/gsi-protocol/src/index.js";
import { startHudService } from "../apps/roundsense/src/hud/server.js";
import { DEFAULT_HUD_SETTINGS } from "../apps/roundsense/src/hud/model.js";

const token = "roundsense-visual-qa-only";
const hud = await startHudService({ token });
const ids = [
  "ct-mid",
  "t-rich",
  "ct-low",
  "retained-rifle",
  "awp",
  "save-awp",
  "pistol-winner",
  "pistol-loser",
  "missing-loss",
  "missing-inventory",
  "pistol",
  "overtime",
  "live",
  "stale",
  "spectator",
];
let current: GsiPayload | null = null;
let generation = 0;
const send = async (payload: GsiPayload) => {
  const response = await fetch(`http://127.0.0.1:${hud.gsiPort}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, auth: { token } }),
  });
  if (!response.ok) throw new Error(`GSI: ${response.status}`);
};
const control = createServer(async (request, response) => {
  if (request.headers.host !== "127.0.0.1:3201") {
    response.writeHead(403).end();
    return;
  }
  if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(ids));
    return;
  }
  const id = (request.url ?? "").slice(1);
  if (request.method !== "POST" || !ids.includes(id)) {
    response.writeHead(404).end();
    return;
  }
  current = null;
  generation++;
  const self = `7656119800000${String(generation).padStart(4, "0")}`;
  const side = id === "t-rich" || id === "pistol-winner" ? "T" : "CT";
  const data: GsiPayload = {
    provider: { appid: 730, steamid: self },
    map: {
      name: "de_mirage",
      mode: "competitive",
      phase: "live",
      round: 8,
      team_ct: { score: 4, consecutive_round_losses: 1 },
      team_t: { score: 3, consecutive_round_losses: 1 },
    },
    round: { phase: "freezetime" },
    player: {
      steamid: self,
      activity: "playing",
      team: side,
      state: { money: 3450, armor: 0, helmet: false, defusekit: false },
      weapons: {},
    },
  };
  if (id === "t-rich") data.player!.state!.money = 8000;
  if (id === "ct-low") data.player!.state!.money = 1200;
  if (id === "retained-rifle") {
    data.player!.state = {
      money: 4200,
      armor: 100,
      helmet: false,
      defusekit: false,
    };
    data.player!.weapons = {
      weapon_0: {
        name: "weapon_m4a1_silencer",
        type: "Rifle",
        state: "active",
      },
      weapon_1: {
        name: "weapon_smokegrenade",
        type: "Grenade",
        ammo_reserve: 1,
      },
    };
  }
  if (id === "awp" || id === "save-awp")
    data.player!.state!.money = id === "awp" ? 7000 : 4200;
  if (id.startsWith("pistol-")) {
    data.map!.round = 1;
    await send(data);
    await send({ ...data, round: { phase: "live" } });
    await send({
      ...data,
      map: { ...data.map, round: 2 },
      player: undefined,
      round: { phase: "over", win_team: "T" },
    });
    data.map!.round = 2;
    data.player!.state!.money = id === "pistol-winner" ? 3250 : 1900;
  }
  if (id === "missing-loss") data.map!.team_ct = { score: 4 };
  if (id === "missing-inventory") data.player!.weapons = undefined;
  if (id === "pistol") {
    data.map!.round = 1;
    data.player!.state!.money = 800;
  }
  if (id === "overtime") {
    data.map!.round = 25;
    data.map!.team_ct!.score = 12;
    data.map!.team_t!.score = 12;
    data.player!.state!.money = 10000;
  }
  if (id === "live") data.round!.phase = "live";
  if (id === "spectator") data.player!.steamid = "76561198999999999";
  await fetch("http://127.0.0.1:3100/settings", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...DEFAULT_HUD_SETTINGS,
      awpPriority:
        id === "awp"
          ? "PREFER"
          : id === "save-awp"
            ? "SAVE_FOR_AWP"
            : "NEUTRAL",
    }),
  });
  await send(data);
  if (id !== "stale") current = data;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(hud.snapshot()));
});
control.listen(3201, "127.0.0.1");
const timer = setInterval(() => {
  if (current) void send(current);
}, 1000);
console.log(
  "Visual QA: POST http://127.0.0.1:3201/<scenario>; HUD http://127.0.0.1:3100/overlay",
);
const stop = async () => {
  clearInterval(timer);
  control.close();
  await hud.close();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
