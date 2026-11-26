-- 0002: [match] (SPEC.md §4). Bracketed because MATCH is a SQL Server keyword.
-- Join step: UPDATE [match] SET playerCount = playerCount + 1
--   WHERE matchId = @matchId AND status = 'lobby' AND playerCount < maxPlayers
-- in the same transaction as the matchPlayer insert; 0 rows changed = join refused.
CREATE TABLE [match] (
  matchId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT pkMatch PRIMARY KEY DEFAULT NEWID(),
  hostId          UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkMatchHost REFERENCES staffAccount (staffAccountId),
  joinCode        NVARCHAR(12)     NOT NULL,
  status          NVARCHAR(10)     NOT NULL CONSTRAINT dfMatchStatus DEFAULT 'lobby',
  durationSeconds INT              NOT NULL,
  startingCoins   INT              NOT NULL,
  roundCoinIncome INT              NOT NULL,
  maxPlayers      INT              NOT NULL,
  playerCount     INT              NOT NULL CONSTRAINT dfMatchPlayerCount DEFAULT 0,
  createdAt       DATETIME2        NOT NULL CONSTRAINT dfMatchCreatedAt DEFAULT SYSUTCDATETIME(),
  startedAt       DATETIME2        NULL,
  endsAt          DATETIME2        NULL,
  finishedAt      DATETIME2        NULL,
  CONSTRAINT ckMatchStatus      CHECK (status IN ('lobby', 'running', 'finished')),
  CONSTRAINT ckMatchDuration    CHECK (durationSeconds > 0),
  CONSTRAINT ckMatchCoins       CHECK (startingCoins >= 0 AND roundCoinIncome >= 0),
  CONSTRAINT ckMatchMaxPlayers  CHECK (maxPlayers BETWEEN 2 AND 8),
  CONSTRAINT ckMatchPlayerCount CHECK (playerCount BETWEEN 0 AND maxPlayers)
);
GO

-- joinCode is unique only while the match is open (lobby or running).
-- Filtered indexes cannot use IN, so the filter is written as <> 'finished'.
CREATE UNIQUE INDEX uxMatchOpenJoinCode ON [match] (joinCode)
  WHERE status <> 'finished';

CREATE INDEX ixMatchHost ON [match] (hostId);
