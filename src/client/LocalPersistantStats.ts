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
      renderRankedResultToast(result);
    }
  });
}

function renderRankedResultToast(result: RankedResultSummary) {
  const change = result.player;
  if (!change) return;

  const existing = document.getElementById("ranked-result-toast");
  existing?.remove();

  const container = document.createElement("div");
  container.id = "ranked-result-toast";
  container.style.cssText =
    "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
    "background:linear-gradient(135deg,rgba(99,102,241,0.95),rgba(56,189,248,0.92));" +
    "color:white;padding:14px 18px;border-radius:14px;" +
    "box-shadow:0 10px 40px rgba(0,0,0,0.35);" +
    "display:flex;align-items:center;gap:12px;z-index:9999;";

  const logo = document.createElement("img");
  logo.src = change.newTier.logo;
  logo.alt = `${change.newTier.name} badge`;
  logo.width = 42;
  logo.height = 42;
  logo.style.borderRadius = "9999px";
  logo.style.border = "2px solid rgba(255,255,255,0.6)";
  logo.style.background = "rgba(15,23,42,0.35)";

  const textWrap = document.createElement("div");
  textWrap.style.display = "flex";
  textWrap.style.flexDirection = "column";
  textWrap.style.gap = "4px";

  const headline = document.createElement("div");
  headline.style.fontWeight = "700";
  headline.style.fontSize = "15px";
  const headlinePrefix = change.promoted
    ? "Promoted"
    : change.demoted
      ? "Demoted"
      : "Rank updated";
  headline.textContent = `${headlinePrefix} • ${change.newTier.name}`;

  const detail = document.createElement("div");
  detail.style.fontSize = "12px";
  detail.style.opacity = "0.95";
  const deltaSign = change.delta >= 0 ? "+" : "";
  detail.textContent = `Rating ${change.previousRating} → ${change.newRating} (${deltaSign}${change.delta}), ${formatRankBand(change.newTier)}`;

  textWrap.appendChild(headline);
  textWrap.appendChild(detail);

  if (result.breakdown) {
    const reasonList = document.createElement("ul");
    reasonList.style.margin = "0";
    reasonList.style.paddingLeft = "16px";
    reasonList.style.fontSize = "12px";
    reasonList.style.opacity = "0.92";
    reasonList.style.display = "flex";
    reasonList.style.flexDirection = "column";
    reasonList.style.gap = "2px";

    result.breakdown.reasons.forEach((reason) => {
      const item = document.createElement("li");
      item.textContent = reason;
      reasonList.appendChild(item);
    });

    textWrap.appendChild(reasonList);
  }

  if (result.clan) {
    const clanDetail = document.createElement("div");
    clanDetail.style.fontSize = "12px";
    clanDetail.style.opacity = "0.9";
    const clanDeltaSign = result.clan.delta >= 0 ? "+" : "";
    clanDetail.textContent = `Clan rating ${result.clan.previousRating} → ${result.clan.newRating} (${clanDeltaSign}${result.clan.delta})`;
    textWrap.appendChild(clanDetail);
  }

  container.appendChild(logo);
  container.appendChild(textWrap);

  document.body.appendChild(container);

  setTimeout(() => {
    container.style.opacity = "0";
    container.style.transition = "opacity 400ms ease";
    setTimeout(() => container.remove(), 400);
  }, 5000);
}
