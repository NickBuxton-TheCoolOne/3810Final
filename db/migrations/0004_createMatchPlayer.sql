-- 0004: matchPlayer (SPEC.md §4). nickname is unique within its match and
-- compared case-insensitively (explicit CI collation, independent of the server default).
CREATE TABLE matchPlayer (
  matchPlayerId UNIQUEIDENTIFIER NOT NULL CONSTRAINT pkMatchPlayer PRIMARY KEY DEFAULT NEWID(),
  matchId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT fkMatchPlayerMatch REFERENCES [match] (matchId),
  nickname      NVARCHAR(20) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,
  coins         INT              NOT NULL,
  score         INT              NOT NULL CONSTRAINT dfMatchPlayerScore DEFAULT 0,
  joinedAt      DATETIME2        NOT NULL CONSTRAINT dfMatchPlayerJoinedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT uqMatchPlayerNickname UNIQUE (matchId, nickname),
  CONSTRAINT ckMatchPlayerCoins CHECK (coins >= 0),
  CONSTRAINT ckMatchPlayerScore CHECK (score >= 0)
);
