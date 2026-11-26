-- 0007: leaderboardEntry (SPEC.md §4). One row per player of a finished match.
-- nickname is copied so the leaderboard reads from this table alone.
CREATE TABLE leaderboardEntry (
  leaderboardEntryId UNIQUEIDENTIFIER NOT NULL CONSTRAINT pkLeaderboardEntry PRIMARY KEY DEFAULT NEWID(),
  matchId            UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkLeaderboardEntryMatch REFERENCES [match] (matchId),
  matchPlayerId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkLeaderboardEntryPlayer REFERENCES matchPlayer (matchPlayerId),
  nickname           NVARCHAR(20)     NOT NULL,
  score              INT              NOT NULL,
  finishedAt         DATETIME2        NOT NULL,
  CONSTRAINT uqLeaderboardEntryPlayer UNIQUE (matchPlayerId),
  CONSTRAINT ckLeaderboardEntryScore  CHECK (score >= 0)
);
GO

CREATE INDEX ixLeaderboardEntryScore ON leaderboardEntry (score DESC, finishedAt DESC);
