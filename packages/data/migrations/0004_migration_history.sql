-- Immutable source evidence is separate from the mutable current-source pointer.
CREATE TABLE legacy_snapshot_versions (
  source_system TEXT NOT NULL, source_table TEXT NOT NULL, source_id TEXT NOT NULL,
  source_hash TEXT NOT NULL, fields_json TEXT NOT NULL CHECK(json_valid(fields_json)),
  source_created_at TEXT, source_updated_at TEXT, captured_at TEXT NOT NULL,
  PRIMARY KEY(source_system,source_table,source_id,source_hash)
);
CREATE TABLE import_record_versions (
  manifest_id TEXT NOT NULL REFERENCES import_manifests(id),
  source_system TEXT NOT NULL, source_table TEXT NOT NULL, source_id TEXT NOT NULL, source_hash TEXT NOT NULL,
  target_table TEXT NOT NULL, target_id TEXT NOT NULL, target_hash TEXT NOT NULL,
  PRIMARY KEY(manifest_id,source_system,source_table,source_id),
  FOREIGN KEY(source_system,source_table,source_id,source_hash) REFERENCES legacy_snapshot_versions(source_system,source_table,source_id,source_hash)
);
INSERT INTO legacy_snapshot_versions SELECT s.source_system,s.source_table,s.source_id,s.source_hash,s.fields_json,s.source_created_at,s.source_updated_at,m.created_at FROM legacy_record_snapshots s JOIN import_manifests m ON m.id=s.manifest_id;
INSERT INTO import_record_versions SELECT manifest_id,source_system,source_table,source_id,source_hash,target_table,target_id,target_hash FROM legacy_record_snapshots;
CREATE TRIGGER legacy_snapshot_versions_immutable_update BEFORE UPDATE ON legacy_snapshot_versions BEGIN SELECT RAISE(ABORT,'immutable_source_snapshot'); END;
CREATE TRIGGER legacy_snapshot_versions_immutable_delete BEFORE DELETE ON legacy_snapshot_versions BEGIN SELECT RAISE(ABORT,'immutable_source_snapshot'); END;
CREATE TRIGGER import_record_versions_immutable_update BEFORE UPDATE ON import_record_versions BEGIN SELECT RAISE(ABORT,'immutable_import_membership'); END;
CREATE TRIGGER import_record_versions_immutable_delete BEFORE DELETE ON import_record_versions BEGIN SELECT RAISE(ABORT,'immutable_import_membership'); END;
