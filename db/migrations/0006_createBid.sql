-- 0006: bid (SPEC.md §4). Accepted bids only; amount is what was added that round.
-- A player's running total on an item is SUM(amount) over their bids on it.
CREATE TABLE bid (
  bidId         UNIQUEIDENTIFIER NOT NULL CONSTRAINT pkBid PRIMARY KEY DEFAULT NEWID(),
  itemId        UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkBidItem REFERENCES item (itemId),
  matchPlayerId UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkBidPlayer REFERENCES matchPlayer (matchPlayerId),
  amount        INT              NOT NULL,
  roundNumber   INT              NOT NULL,
  receivedAt    DATETIME2        NOT NULL CONSTRAINT dfBidReceivedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT uqBidPerRound UNIQUE (itemId, matchPlayerId, roundNumber),
  CONSTRAINT ckBidAmount   CHECK (amount >= 1),
  CONSTRAINT ckBidRound    CHECK (roundNumber >= 1)
);
