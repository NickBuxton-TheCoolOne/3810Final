-- 0005: item (SPEC.md §4). One item spawns per round.
-- No cascading deletes anywhere: item has two FKs to matchPlayer.
CREATE TABLE item (
  itemId             UNIQUEIDENTIFIER NOT NULL CONSTRAINT pkItem PRIMARY KEY DEFAULT NEWID(),
  matchId            UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkItemMatch REFERENCES [match] (matchId),
  pointValue         INT              NOT NULL,
  spawnRound         INT              NOT NULL,
  lifetimeRounds     INT              NOT NULL,
  roundsLeft         INT              NOT NULL,
  status             NVARCHAR(10)     NOT NULL CONSTRAINT dfItemStatus DEFAULT 'open',
  currentBid         INT              NOT NULL CONSTRAINT dfItemCurrentBid DEFAULT 0,
  currentBidHolderId UNIQUEIDENTIFIER NULL CONSTRAINT fkItemBidHolder REFERENCES matchPlayer (matchPlayerId),
  winnerPlayerId     UNIQUEIDENTIFIER NULL CONSTRAINT fkItemWinner REFERENCES matchPlayer (matchPlayerId),
  closedRound        INT              NULL,
  CONSTRAINT uqItemSpawnRound  UNIQUE (matchId, spawnRound),
  CONSTRAINT ckItemPointValue  CHECK (pointValue BETWEEN 10 AND 100),
  CONSTRAINT ckItemSpawnRound  CHECK (spawnRound >= 1),
  CONSTRAINT ckItemLifetime    CHECK (lifetimeRounds BETWEEN 1 AND 5),
  CONSTRAINT ckItemRoundsLeft  CHECK (roundsLeft BETWEEN 0 AND lifetimeRounds),
  CONSTRAINT ckItemStatus      CHECK (status IN ('open', 'closed')),
  CONSTRAINT ckItemCurrentBid  CHECK (currentBid >= 0),
  CONSTRAINT ckItemClosedRound CHECK (closedRound IS NULL OR closedRound >= spawnRound)
);
GO

CREATE INDEX ixItemMatchStatus ON item (matchId, status);
