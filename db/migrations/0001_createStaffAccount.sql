-- 0001: staffAccount (SPEC.md §4). Host or Admin login.
-- Admin rows are inserted only by developer-run seed scripts.
CREATE TABLE staffAccount (
  staffAccountId UNIQUEIDENTIFIER NOT NULL CONSTRAINT pkStaffAccount PRIMARY KEY DEFAULT NEWID(),
  username       NVARCHAR(50)     NOT NULL,
  passwordHash   NVARCHAR(255)    NOT NULL,
  role           NVARCHAR(10)     NOT NULL,
  isActive       BIT              NOT NULL CONSTRAINT dfStaffAccountIsActive DEFAULT 1,
  createdAt      DATETIME2        NOT NULL CONSTRAINT dfStaffAccountCreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT uqStaffAccountUsername UNIQUE (username),
  CONSTRAINT ckStaffAccountRole CHECK (role IN ('host', 'admin'))
);
