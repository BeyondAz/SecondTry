BEGIN;

CREATE TABLE IF NOT EXISTS second_try.paid_request_counters (
  address_hash char(64) NOT NULL
    CHECK (address_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL
    CHECK (request_count BETWEEN 1 AND 11),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (address_hash, window_start),
  CHECK (expires_at > window_start)
);

CREATE INDEX IF NOT EXISTS paid_request_counters_expires_at_idx
  ON second_try.paid_request_counters (expires_at);

COMMIT;
