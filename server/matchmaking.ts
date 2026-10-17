import type { DatabaseSync } from "node:sqlite";

export function createMatchmakingTables(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ghost_matchmaking (
      ghost_seq INTEGER PRIMARY KEY REFERENCES ghosts(seq) ON DELETE CASCADE,
      elo INTEGER NOT NULL CHECK(elo>=0),
      wins INTEGER NOT NULL CHECK(wins>=0),
      lives INTEGER NOT NULL CHECK(lives>=0),
      games INTEGER NOT NULL CHECK(games>=0)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS match_history (
      guest TEXT NOT NULL REFERENCES guests(id), run TEXT NOT NULL,
      round INTEGER NOT NULL, opponent TEXT NOT NULL REFERENCES guests(id),
      PRIMARY KEY(guest,run,round)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS match_history_opponent ON match_history(guest,run,opponent);
    CREATE INDEX IF NOT EXISTS ghosts_queue_round_guest ON ghosts(ranked,round,guest,seq);
  `);
}
