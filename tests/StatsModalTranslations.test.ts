import fs from "fs";
import path from "path";

const statsModalKeys = [
  "title",
  "ranked_title",
  "loading",
  "error",
  "no_player_stats",
  "no_clan_stats",
  "rank",
  "player",
  "clan",
  "rating",
  "wins",
  "losses",
  "games",
  "ranked_only",
  "last_updated",
  "retry",
  "players_tab",
  "clans_tab",
  "rank_points",
  "total_rank_points",
  "tier",
];

describe("stats modal translations", () => {
  const langDir = path.join(__dirname, "..", "resources", "lang");

  test("all translation files include rank-related labels", () => {
    const files = fs
      .readdirSync(langDir)
      .filter((file) => file.endsWith(".json"));

    for (const file of files) {
      const jsonPath = path.join(langDir, file);
      const translation = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const statsModal = translation.stats_modal;

      expect(statsModal).toBeDefined();

      for (const key of statsModalKeys) {
        expect(statsModal[key]).toBeDefined();
      }
    }
  });
});
