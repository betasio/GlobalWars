import { GameMode } from "../../../src/core/game/Game";
import {
  RankedPlayerContext,
  computeRankedResultsForGame,
} from "../../../src/core/ranked/Scoring";
import { Winner } from "../../../src/core/Schemas";

describe("ranked scoring", () => {
  const players: RankedPlayerContext[] = [
    {
      clientID: "winner",
      username: "TopPlayer",
      stats: { conquests: 12, gold: 25000 },
    },
    {
      clientID: "mid",
      username: "MidPlayer",
      stats: { conquests: 5, gold: 10000, killedAt: 10 },
    },
    {
      clientID: "early",
      username: "EarlyExit",
      stats: { conquests: 1, gold: 1000, killedAt: 5 },
    },
  ];

  const winner: Winner = ["player", "winner"];

  test("computes placement-driven rating deltas", () => {
    const results = computeRankedResultsForGame(GameMode.FFA, players, winner);
    const resultsById = new Map(
      results.map((result) => [result.clientID, result]),
    );

    const top = resultsById.get("winner");
    const last = resultsById.get("early");

    expect(top?.placement.position).toBe(1);
    expect(top?.placement.isWinner).toBe(true);
    expect(top?.ratingDelta).toBe(37);
    expect(top?.performance.score).toBe(10);

    expect(last?.placement.position).toBe(3);
    expect(last?.placement.isWinner).toBe(false);
    expect(last?.ratingDelta).toBe(-10);
    expect(last?.performance.score).toBe(1);
  });

  test("applies team mode modifiers to rating changes", () => {
    const results = computeRankedResultsForGame(GameMode.Team, players, winner);
    const winnerResult = results.find((result) => result.clientID === "winner");
    const midResult = results.find((result) => result.clientID === "mid");

    expect(winnerResult?.ratingDelta).toBe(32);
    expect(midResult?.ratingDelta).toBe(7);
  });
});
