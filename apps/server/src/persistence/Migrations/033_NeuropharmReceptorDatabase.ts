import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_source_cache (
      source_record_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      url TEXT,
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_neuropharm_source_cache_source_external
    ON neuropharm_source_cache(source, external_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_compounds (
      compound_id TEXT PRIMARY KEY,
      preferred_name TEXT NOT NULL,
      synonyms_json TEXT NOT NULL,
      pubchem_cid TEXT,
      chembl_id TEXT,
      iuphar_ligand_id TEXT,
      molecular_formula TEXT,
      canonical_smiles TEXT,
      inchi_key TEXT,
      source_ids_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_compounds_preferred_name
    ON neuropharm_compounds(preferred_name)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_targets (
      target_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      family TEXT,
      organism TEXT,
      source_ids_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_targets_name
    ON neuropharm_targets(name)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_interactions (
      interaction_id TEXT PRIMARY KEY,
      compound_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      compound_name TEXT NOT NULL,
      target_name TEXT NOT NULL,
      source TEXT NOT NULL,
      evidence_grade TEXT NOT NULL,
      action TEXT,
      measurement_type TEXT,
      value REAL,
      relation TEXT,
      units TEXT,
      assay_context TEXT,
      publication_ids_json TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_interactions_compound
    ON neuropharm_interactions(compound_id, target_name)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_interactions_target
    ON neuropharm_interactions(target_id, compound_name)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_publications (
      publication_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      abstract TEXT,
      journal TEXT,
      year INTEGER,
      url TEXT,
      source_ids_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_neuropharm_publications_title
    ON neuropharm_publications(title)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_sync_jobs (
      sync_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      compounds_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS neuropharm_local_database_snapshots (
      source TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      download_url TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT NOT NULL,
      version TEXT,
      downloaded_at TEXT,
      imported_at TEXT,
      bytes REAL,
      row_count INTEGER NOT NULL,
      checksum_sha256 TEXT,
      error TEXT
    )
  `;
});
