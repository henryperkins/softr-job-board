-- Durable identity survives Workflow retention. Never reset a successful date.
ALTER TABLE ingestion_runs ADD COLUMN workflow_id TEXT;
ALTER TABLE ingestion_runs ADD COLUMN cursor TEXT;
ALTER TABLE ingestion_runs ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN capture_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN captured_at TEXT;
ALTER TABLE ingestion_runs ADD COLUMN finished_at TEXT;
ALTER TABLE ingestion_runs ADD COLUMN failure_code TEXT;
ALTER TABLE ingestion_runs ADD COLUMN retry_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN created_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN updated_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN unchanged_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN closed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN rejected_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN last_error TEXT;
ALTER TABLE outbox ADD COLUMN lease_until TEXT;
CREATE UNIQUE INDEX ingestion_workflow_id ON ingestion_runs(workflow_id);
CREATE INDEX outbox_dispatch ON outbox(kind,state,available_at);
CREATE TABLE ingestion_pages (
 run_id TEXT NOT NULL REFERENCES ingestion_runs(id), page INTEGER NOT NULL,
 request_cursor TEXT, next_cursor TEXT, object_key TEXT NOT NULL, checksum TEXT NOT NULL,
 bytes INTEGER NOT NULL, captured_at TEXT NOT NULL, row_count INTEGER NOT NULL,
 staged_count INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL,
 PRIMARY KEY(run_id,page)
);
CREATE TABLE ingestion_backlog (
 run_id TEXT NOT NULL REFERENCES ingestion_runs(id), external_id TEXT NOT NULL,
 page INTEGER NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 content_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', action TEXT, job_id TEXT,
 PRIMARY KEY(run_id,external_id)
);
CREATE INDEX ingestion_backlog_pending ON ingestion_backlog(run_id,state,external_id);
CREATE TABLE source_observations (
 source TEXT PRIMARY KEY, last_success_at TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES ingestion_runs(id), row_count INTEGER NOT NULL
);
CREATE TABLE ingestion_source_jobs (
 source TEXT NOT NULL, external_id TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id),
 canonical_url TEXT, content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL,
 observed_run_id TEXT NOT NULL REFERENCES ingestion_runs(id), observed_at TEXT NOT NULL,
 status TEXT NOT NULL, PRIMARY KEY(source,external_id)
);
CREATE INDEX ingestion_source_url ON ingestion_source_jobs(canonical_url);
CREATE TABLE job_source_owners (job_id TEXT PRIMARY KEY REFERENCES jobs(id), source TEXT NOT NULL, external_id TEXT NOT NULL);
CREATE TABLE ingestion_reviews (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ingestion_runs(id), external_id TEXT,
 reason TEXT NOT NULL, details_json TEXT NOT NULL CHECK(json_valid(details_json)), created_at TEXT NOT NULL
);
-- Optimistic reads may race across independent sources. Fail the entire batch.
CREATE TABLE ingestion_transaction_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE TRIGGER ingestion_page_evidence_immutable BEFORE UPDATE OF object_key,checksum,bytes,captured_at ON ingestion_pages BEGIN SELECT RAISE(ABORT,'immutable_capture'); END;
