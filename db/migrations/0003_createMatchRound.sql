-- 0003: matchRound (SPEC.md §4). One row per round of a match.
-- The resolution job claims the round first:
--   UPDATE matchRound SET resolvedAt = SYSUTCDATETIME()
--   WHERE matchId = @matchId AND roundNumber = @roundNumber AND resolvedAt IS NULL
-- 0 rows changed = already resolved, so the job exits without charging or scoring.
CREATE TABLE matchRound (
  matchId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkMatchRoundMatch REFERENCES [match] (matchId),
  roundNumber INT              NOT NULL,
  startedAt   DATETIME2        NOT NULL,
  endsAt      DATETIME2        NOT NULL,
  resolvedAt  DATETIME2        NULL,
  CONSTRAINT pkMatchRound       PRIMARY KEY (matchId, roundNumber),
  CONSTRAINT ckMatchRoundNumber CHECK (roundNumber >= 1),
  CONSTRAINT ckMatchRoundWindow CHECK (endsAt > startedAt)
);
