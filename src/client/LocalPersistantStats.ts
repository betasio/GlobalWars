import { formatRankBand } from "../core/Ranks";
import { GameConfig, GameID, PartialGameRecord } from "../core/Schemas";
import { replacer } from "../core/Util";
import { RankedResultSummary, recordRankedResult } from "./firebaseAuth";

export interface LocalStatsData {
  [key: GameID]: {
    lobby: Partial<GameConfig>;
    // Only once the game is over
    gameRecord?: PartialGameRecord;
  };
}

let _startTime: number;

function getStats(): LocalStatsData {
  const statsStr = localStorage.getItem("game-records");
  return statsStr ? JSON.parse(statsStr) : {};
}

function save(stats: LocalStatsData) {
  // To execute asynchronously
  setTimeout(
    () => localStorage.setItem("game-records", JSON.stringify(stats, replacer)),
    0,
  );
}

// The user can quit the game anytime so better save the lobby as soon as the
// game starts.
export function startGame(id: GameID, lobby: Partial<GameConfig>) {
  if (localStorage === undefined) {
    return;
  }

  _startTime = Date.now();
  const stats = getStats();
  stats[id] = { lobby };
  save(stats);
}

export function startTime() {
  return _startTime;
}

export function endGame(gameRecord: PartialGameRecord) {
  if (localStorage === undefined) {
    return;
  }

  const stats = getStats();
  const gameStat = stats[gameRecord.info.gameID];

  if (!gameStat) {
    console.log("LocalPersistantStats: game not found");
    return;
  }

  gameStat.gameRecord = gameRecord;
  save(stats);

  // Update ranked stats for authenticated players; guests are ignored inside
  // the helper and will no-op.
  void recordRankedResult(gameRecord).then((result) => {
    if (result) {
      renderRankedResultScreen(result);
    }
  });
}

function renderRankedResultScreen(result: RankedResultSummary) {
  const change = result.player;
  if (!change) return;

  const existing = document.getElementById("ranked-result-screen");
  existing?.remove();

  const overlay = document.createElement("div");
  overlay.id = "ranked-result-screen";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);" +
    "display:flex;align-items:center;justify-content:center;z-index:10000;";

  const card = document.createElement("div");
  card.style.cssText =
    "width:min(720px,92vw);background:linear-gradient(135deg,#0f172a,#0b1222);" +
    "border:1px solid rgba(255,255,255,0.08);box-shadow:0 25px 80px rgba(0,0,0,0.5);" +
    "border-radius:22px;padding:28px;display:flex;flex-direction:column;gap:20px;color:white;";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";

  const title = document.createElement("div");
  title.textContent = "Ranked Match Summary";
  title.style.fontSize = "22px";
  title.style.fontWeight = "700";

  const closeButton = document.createElement("button");
  closeButton.textContent = "Close";
  closeButton.style.cssText =
    "background:rgba(255,255,255,0.08);color:white;border:1px solid rgba(255,255,255,0.15);" +
    "border-radius:10px;padding:8px 14px;cursor:pointer;";
  closeButton.onclick = () => overlay.remove();

  header.appendChild(title);
  header.appendChild(closeButton);

  const body = document.createElement("div");
  body.style.display = "grid";
  body.style.gridTemplateColumns = "120px 1fr";
  body.style.gap = "18px";
  body.style.alignItems = "center";
  body.style.flex = "1";

  const logoWrap = document.createElement("div");
  logoWrap.style.display = "flex";
  logoWrap.style.justifyContent = "center";
  logoWrap.style.alignItems = "center";
  logoWrap.style.padding = "10px";
  logoWrap.style.background = "rgba(255,255,255,0.04)";
  logoWrap.style.borderRadius = "18px";
  logoWrap.style.border = "1px solid rgba(255,255,255,0.08)";

  const logo = document.createElement("img");
  logo.src = change.newTier.logo;
  logo.alt = `${change.newTier.name} badge`;
  logo.width = 96;
  logo.height = 96;
  logo.style.borderRadius = "14px";
  logo.style.border = "2px solid rgba(255,255,255,0.25)";
  logo.style.background = "rgba(15,23,42,0.65)";

  logoWrap.appendChild(logo);

  const detailWrap = document.createElement("div");
  detailWrap.style.display = "flex";
  detailWrap.style.flexDirection = "column";
  detailWrap.style.gap = "8px";

  const headline = document.createElement("div");
  headline.style.fontWeight = "700";
  headline.style.fontSize = "18px";
  const headlinePrefix = change.promoted
    ? "Promoted"
    : change.demoted
      ? "Demoted"
      : "Rank updated";
  headline.textContent = `${headlinePrefix} • ${change.newTier.name}`;

  const deltaSign = change.delta >= 0 ? "+" : "";
  const deltaChip = document.createElement("div");
  deltaChip.textContent = `${deltaSign}${change.delta} rank points (${change.previousRating} → ${change.newRating})`;
  deltaChip.style.cssText =
    `display:inline-flex;align-items:center;gap:8px;` +
    `padding:10px 12px;border-radius:12px;width:fit-content;font-weight:600;` +
    `background:${change.delta >= 0 ? "rgba(34,197,94,0.14)" : "rgba(248,113,113,0.16)"};` +
    `border:1px solid ${change.delta >= 0 ? "rgba(34,197,94,0.35)" : "rgba(248,113,113,0.35)"};`;

  const bandDetail = document.createElement("div");
  bandDetail.style.fontSize = "14px";
  bandDetail.style.opacity = "0.92";
  bandDetail.textContent = `Current tier: ${formatRankBand(change.newTier)}`;

  const breakdownWrap = document.createElement("div");
  breakdownWrap.style.display = "grid";
  breakdownWrap.style.gridTemplateColumns =
    "repeat(auto-fit,minmax(180px,1fr))";
  breakdownWrap.style.gap = "10px";
  breakdownWrap.style.marginTop = "6px";

  const placement = result.breakdown?.placement;
  const performance = result.breakdown?.performance;
  const mode = result.breakdown?.mode;

  if (placement) {
    const placementCard = document.createElement("div");
    placementCard.style.cssText =
      "padding:12px;border-radius:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.07);";
    placementCard.innerHTML =
      `<div style='font-weight:700;font-size:14px;margin-bottom:4px;'>Placement</div>` +
      `<div style='font-size:13px;'>${placement.position}/${placement.totalPlayers} (${placement.isWinner ? "Winner" : "Finished"})</div>` +
      `<div style='font-size:12px;opacity:0.85;'>${placement.reason}</div>`;
    breakdownWrap.appendChild(placementCard);
  }

  if (performance) {
    const perfCard = document.createElement("div");
    perfCard.style.cssText =
      "padding:12px;border-radius:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.07);";
    perfCard.innerHTML =
      `<div style='font-weight:700;font-size:14px;margin-bottom:4px;'>Performance</div>` +
      `<div style='font-size:13px;'>Conquests: ${performance.conquests} • Gold: ${Math.round(performance.gold)}</div>` +
      `<div style='font-size:12px;opacity:0.85;'>${performance.reason}</div>`;
    breakdownWrap.appendChild(perfCard);
  }

  if (mode) {
    const modeCard = document.createElement("div");
    modeCard.style.cssText =
      "padding:12px;border-radius:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.07);";
    modeCard.innerHTML =
      `<div style='font-weight:700;font-size:14px;margin-bottom:4px;'>Mode</div>` +
      `<div style='font-size:13px;'>${mode.gameMode} modifier ×${mode.modifier.toFixed(2)}</div>` +
      `<div style='font-size:12px;opacity:0.85;'>${mode.reason}</div>`;
    breakdownWrap.appendChild(modeCard);
  }

  if (result.clan) {
    const clanCard = document.createElement("div");
    clanCard.style.cssText =
      "padding:12px;border-radius:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.07);";
    const clanDeltaSign = result.clan.delta >= 0 ? "+" : "";
    clanCard.innerHTML =
      `<div style='font-weight:700;font-size:14px;margin-bottom:4px;'>Clan Impact</div>` +
      `<div style='font-size:13px;'>${clanDeltaSign}${result.clan.delta} clan rank points</div>` +
      `<div style='font-size:12px;opacity:0.85;'>${result.clan.previousRating} → ${result.clan.newRating}</div>`;
    breakdownWrap.appendChild(clanCard);
  }

  detailWrap.appendChild(headline);
  detailWrap.appendChild(deltaChip);
  detailWrap.appendChild(bandDetail);
  if (breakdownWrap.childElementCount) {
    detailWrap.appendChild(breakdownWrap);
  }

  body.appendChild(logoWrap);
  body.appendChild(detailWrap);

  card.appendChild(header);
  card.appendChild(body);

  overlay.appendChild(card);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);

  setTimeout(() => overlay.remove(), 10000);
}
