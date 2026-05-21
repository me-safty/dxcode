import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type {
  NeuropharmCompoundIdentity,
  NeuropharmInteractionRecord,
  NeuropharmLocalDatabaseManifestEntry,
  NeuropharmLocalDatabaseSnapshot,
  NeuropharmLocalDatabaseSource,
  NeuropharmTargetRecord,
} from "@t3tools/contracts";

const IUPHAR_BASE_URL = "https://www.guidetopharmacology.org";
const BINDINGDB_BASE_URL = "https://www.bindingdb.org";
const BINDINGDB_DOWNLOADS_URL = `${BINDINGDB_BASE_URL}/rwd/bind/downloads`;

export const LOCAL_DATABASE_MANIFEST = [
  {
    source: "iuphar",
    title: "IUPHAR/BPS Guide to Pharmacology receptor interactions",
    description:
      "Receptor-first local source. Imports the public GtoPdb interactions TSV into searchable compound, target, and interaction tables.",
    url: "https://www.guidetopharmacology.org/download.jsp",
    downloadUrl: `${IUPHAR_BASE_URL}/DATA/interactions.tsv`,
    fileName: "iuphar_interactions.tsv",
    importMode: "tsv",
    priority: 1,
  },
  {
    source: "iuphar_ligands",
    title: "IUPHAR/BPS ligand catalog",
    description:
      "Public GtoPdb ligand metadata TSV for local receptor and compound name grounding.",
    url: "https://www.guidetopharmacology.org/download.jsp",
    downloadUrl: `${IUPHAR_BASE_URL}/DATA/ligands.tsv`,
    fileName: "iuphar_ligands.tsv",
    importMode: "tsv",
    priority: 2,
  },
  {
    source: "iuphar_targets",
    title: "IUPHAR/BPS targets and families",
    description:
      "Public GtoPdb target/family metadata TSV for receptor, transporter, enzyme, and channel grounding.",
    url: "https://www.guidetopharmacology.org/download.jsp",
    downloadUrl: `${IUPHAR_BASE_URL}/DATA/targets_and_families.tsv`,
    fileName: "iuphar_targets_and_families.tsv",
    importMode: "tsv",
    priority: 3,
  },
  {
    source: "iuphar_physchem",
    title: "IUPHAR/BPS ligand physicochemical properties",
    description: "Public GtoPdb ligand physicochemical TSV for local molecular-property context.",
    url: "https://www.guidetopharmacology.org/download.jsp",
    downloadUrl: `${IUPHAR_BASE_URL}/DATA/ligand_physchem_properties.tsv`,
    fileName: "iuphar_ligand_physchem_properties.tsv",
    importMode: "tsv",
    priority: 4,
  },
  {
    source: "bindingdb",
    title: "BindingDB all measurements TSV",
    description:
      "Affinity-measurement TSV archive with Ki, Kd, IC50, EC50-style binding rows. Kept under the 1.5 GB local database cap as a downloadable archive.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_All_202605_tsv.zip`,
    fileName: "BindingDB_All_202605_tsv.zip",
    estimatedSizeBytes: 581_014_061,
    importMode: "zip_archive",
    priority: 5,
  },
  {
    source: "bindingdb_chembl",
    title: "BindingDB ChEMBL subset TSV",
    description:
      "BindingDB ChEMBL subset archive for local ligand-target measurement context without the multi-GB ChEMBL SQLite download.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_ChEMBL_202605_tsv.zip`,
    fileName: "BindingDB_ChEMBL_202605_tsv.zip",
    estimatedSizeBytes: 341_430_307,
    importMode: "zip_archive",
    priority: 6,
  },
  {
    source: "bindingdb_patents",
    title: "BindingDB patents TSV",
    description:
      "BindingDB patent-derived binding measurements archive for local medicinal-chemistry context.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_Patents_202605_tsv.zip`,
    fileName: "BindingDB_Patents_202605_tsv.zip",
    estimatedSizeBytes: 164_742_545,
    importMode: "zip_archive",
    priority: 7,
  },
  {
    source: "bindingdb_pubchem",
    title: "BindingDB PubChem subset TSV",
    description:
      "BindingDB PubChem-linked binding measurements archive for local cross-reference context.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_PubChem_202605_tsv.zip`,
    fileName: "BindingDB_PubChem_202605_tsv.zip",
    estimatedSizeBytes: 23_467_373,
    importMode: "zip_archive",
    priority: 8,
  },
  {
    source: "bindingdb_articles",
    title: "BindingDB article subset TSV",
    description: "BindingDB literature article subset archive for citation-linked binding context.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_BindingDB_Articles_202605_tsv.zip`,
    fileName: "BindingDB_BindingDB_Articles_202605_tsv.zip",
    estimatedSizeBytes: 18_053_530,
    importMode: "zip_archive",
    priority: 9,
  },
  {
    source: "bindingdb_assays",
    title: "BindingDB assay metadata TSV",
    description: "BindingDB assay metadata archive for local assay-context grounding.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_Assays_202605_tsv.zip`,
    fileName: "BindingDB_Assays_202605_tsv.zip",
    estimatedSizeBytes: 9_844_453,
    importMode: "zip_archive",
    priority: 10,
  },
  {
    source: "bindingdb_pdsp",
    title: "BindingDB PDSP Ki subset TSV",
    description:
      "BindingDB PDSP Ki subset archive for receptor-panel affinity context relevant to neuropharmacology.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_PDSPKi_202605_tsv.zip`,
    fileName: "BindingDB_PDSPKi_202605_tsv.zip",
    estimatedSizeBytes: 5_577_416,
    importMode: "zip_archive",
    priority: 10,
  },
  {
    source: "bindingdb_rsid",
    title: "BindingDB RSID/EAID mapping TSV",
    description: "BindingDB identifier mapping archive for local source-record reconciliation.",
    url: "https://www.bindingdb.org/rwd/bind/chemsearch/marvin/Download.jsp",
    downloadUrl: `${BINDINGDB_DOWNLOADS_URL}/BindingDB_rsid_eaids_202605_tsv.zip`,
    fileName: "BindingDB_rsid_eaids_202605_tsv.zip",
    estimatedSizeBytes: 7_399_898,
    importMode: "zip_archive",
    priority: 10,
  },
] satisfies ReadonlyArray<NeuropharmLocalDatabaseManifestEntry>;

export interface LocalDatabaseDownloadOutcome {
  readonly snapshot: NeuropharmLocalDatabaseSnapshot;
  readonly compounds: ReadonlyArray<NeuropharmCompoundIdentity>;
  readonly targets: ReadonlyArray<NeuropharmTargetRecord>;
  readonly interactions: ReadonlyArray<NeuropharmInteractionRecord>;
}

function stableId(prefix: string, parts: ReadonlyArray<string>): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function cleanHtml(value: string | undefined): string {
  return normalize(value?.replace(/<[^>]*>/g, ""));
}

function optional(value: string | undefined): string | undefined {
  const normalized = normalize(value);
  return normalized.length > 0 ? normalized : undefined;
}

function numberValue(value: string | undefined): number | undefined {
  const cleaned = normalize(value);
  if (!cleaned) return undefined;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function splitTsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "\t" && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function mapHeaders(headers: ReadonlyArray<string>): Map<string, number> {
  return new Map(headers.map((header, index) => [header, index]));
}

function rowValue(row: ReadonlyArray<string>, headers: ReadonlyMap<string, number>, key: string) {
  const index = headers.get(key);
  return index === undefined ? undefined : row[index];
}

function extractVersion(text: string): string | undefined {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const match = /GtoPdb Version:\s*([^"]+)/i.exec(firstLine);
  return match ? normalize(match[1]) : undefined;
}

function isImportableIupharInteractionSource(source: NeuropharmLocalDatabaseSource): boolean {
  return source === "iuphar";
}

async function streamDownloadToFile(input: {
  readonly response: Response;
  readonly filePath: string;
}): Promise<{ readonly bytes: number; readonly checksumSha256: string }> {
  if (!input.response.body) {
    throw new Error("Download response did not include a readable body.");
  }

  const tempPath = `${input.filePath}.download`;
  const hash = createHash("sha256");
  let bytes = 0;
  const { createWriteStream } = await import("node:fs");
  const nodeStream = Readable.fromWeb(input.response.body as never);
  nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    hash.update(buffer);
  });

  await pipeline(nodeStream, createWriteStream(tempPath));

  const fs = await import("node:fs/promises");
  await fs.rename(tempPath, input.filePath);
  return { bytes, checksumSha256: hash.digest("hex") };
}

function parseIupharInteractions(
  text: string,
  fetchedAt: string,
): Omit<LocalDatabaseDownloadOutcome, "snapshot"> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerLine = lines.find((line) => line.includes("Target ID") && line.includes("Ligand ID"));
  if (!headerLine) {
    return { compounds: [], targets: [], interactions: [] };
  }
  const headerIndex = lines.indexOf(headerLine);
  const headers = mapHeaders(splitTsvLine(headerLine));
  const compounds = new Map<string, NeuropharmCompoundIdentity>();
  const targets = new Map<string, NeuropharmTargetRecord>();
  const interactions = new Map<string, NeuropharmInteractionRecord>();

  for (const line of lines.slice(headerIndex + 1)) {
    const row = splitTsvLine(line);
    const ligandId = optional(rowValue(row, headers, "Ligand ID"));
    const ligandName = cleanHtml(rowValue(row, headers, "Ligand"));
    const targetId = optional(rowValue(row, headers, "Target ID"));
    const targetName = cleanHtml(rowValue(row, headers, "Target"));
    if (!ligandId || !ligandName || !targetId || !targetName) continue;

    const compoundId = stableId("compound", ["iuphar", ligandId]);
    const targetRecordId = stableId("target", ["iuphar", targetId]);
    const sourceId = stableId("source-record", ["iuphar-local", ligandId, targetId]);
    const synonyms = [ligandName, cleanHtml(rowValue(row, headers, "Target Ligand"))].filter(
      (value, index, all) => value.length > 0 && all.indexOf(value) === index,
    );

    compounds.set(compoundId, {
      compoundId,
      preferredName: ligandName,
      synonyms: synonyms.length > 0 ? synonyms : [ligandName],
      iupharLigandId: ligandId,
      sourceIds: [sourceId],
    });

    targets.set(targetRecordId, {
      targetId: targetRecordId,
      name: targetName,
      type: optional(rowValue(row, headers, "Type")) ?? "target",
      family: optional(rowValue(row, headers, "Target Gene Symbol")),
      organism: optional(rowValue(row, headers, "Target Species")),
      sourceIds: [sourceId],
    });

    const interactionId = stableId("interaction", [
      "iuphar-local",
      ligandId,
      targetId,
      rowValue(row, headers, "Action") ?? "",
      rowValue(row, headers, "Affinity Median") ?? "",
      rowValue(row, headers, "PubMed ID") ?? "",
    ]);
    const pubmedIds = (rowValue(row, headers, "PubMed ID") ?? "")
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => `pubmed-${value}`);

    interactions.set(interactionId, {
      interactionId,
      compoundId,
      targetId: targetRecordId,
      compoundName: ligandName,
      targetName,
      source: "iuphar",
      evidenceGrade: numberValue(rowValue(row, headers, "Affinity Median"))
        ? "measured"
        : "inferred",
      action: optional(rowValue(row, headers, "Action")),
      measurementType: optional(rowValue(row, headers, "Original Affinity Units")),
      value: numberValue(rowValue(row, headers, "Original Affinity Median nm")),
      relation: optional(rowValue(row, headers, "Original Affinity Relation")),
      units: optional(rowValue(row, headers, "Original Affinity Units")) ? "nM" : undefined,
      assayContext: optional(rowValue(row, headers, "Assay Description")),
      publicationIds: pubmedIds,
      sourceIds: [sourceId],
      fetchedAt,
    });
  }

  return {
    compounds: [...compounds.values()],
    targets: [...targets.values()],
    interactions: [...interactions.values()],
  };
}

export function sourceManifest(
  source: NeuropharmLocalDatabaseSource,
): NeuropharmLocalDatabaseManifestEntry {
  const entry = LOCAL_DATABASE_MANIFEST.find((candidate) => candidate.source === source);
  if (!entry) throw new Error(`Unknown local neuropharm source: ${source}`);
  return entry;
}

export function localDatabasePath(baseDirectory: string, source: NeuropharmLocalDatabaseSource) {
  return `${baseDirectory.replace(/\/+$/, "")}/${sourceManifest(source).fileName}`;
}

export function buildMissingSnapshot(input: {
  readonly baseDirectory: string;
  readonly source: NeuropharmLocalDatabaseSource;
}): NeuropharmLocalDatabaseSnapshot {
  const manifest = sourceManifest(input.source);
  return {
    source: manifest.source,
    status: "not_downloaded",
    title: manifest.title,
    url: manifest.url,
    downloadUrl: manifest.downloadUrl,
    fileName: manifest.fileName,
    filePath: localDatabasePath(input.baseDirectory, manifest.source),
    rowCount: 0,
  };
}

export async function downloadLocalDatabase(input: {
  readonly baseDirectory: string;
  readonly source: NeuropharmLocalDatabaseSource;
  readonly fetchedAt: string;
  readonly forceRefresh?: boolean;
}): Promise<LocalDatabaseDownloadOutcome> {
  const manifest = sourceManifest(input.source);
  const filePath = localDatabasePath(input.baseDirectory, input.source);
  const fs = await import("node:fs/promises");
  await fs.mkdir(input.baseDirectory, { recursive: true });

  if (!input.forceRefresh) {
    try {
      const existing = await fs.stat(filePath);
      if (existing.size > 0 && !isImportableIupharInteractionSource(manifest.source)) {
        return {
          snapshot: {
            source: manifest.source,
            status: "downloaded",
            title: manifest.title,
            url: manifest.url,
            downloadUrl: manifest.downloadUrl,
            fileName: manifest.fileName,
            filePath,
            bytes: existing.size,
            rowCount: 0,
          },
          compounds: [],
          targets: [],
          interactions: [],
        };
      }
    } catch {
      // Missing files fall through to download.
    }
  }

  const response = await globalThis.fetch(manifest.downloadUrl, {
    headers: { accept: "*/*" },
  });
  if (!response.ok) {
    throw new Error(
      `${manifest.source} download failed: ${response.status} ${response.statusText}`,
    );
  }
  const { bytes, checksumSha256 } = await streamDownloadToFile({ response, filePath });

  if (!isImportableIupharInteractionSource(manifest.source)) {
    return {
      snapshot: {
        source: manifest.source,
        status: "downloaded",
        title: manifest.title,
        url: manifest.url,
        downloadUrl: manifest.downloadUrl,
        fileName: manifest.fileName,
        filePath,
        downloadedAt: input.fetchedAt,
        bytes,
        checksumSha256,
        rowCount: 0,
      },
      compounds: [],
      targets: [],
      interactions: [],
    };
  }

  const text = await fs.readFile(filePath, "utf8");
  const imported = parseIupharInteractions(text, input.fetchedAt);
  return {
    snapshot: {
      source: manifest.source,
      status: "imported",
      title: manifest.title,
      url: manifest.url,
      downloadUrl: manifest.downloadUrl,
      fileName: manifest.fileName,
      filePath,
      version: extractVersion(text),
      downloadedAt: input.fetchedAt,
      importedAt: input.fetchedAt,
      bytes,
      checksumSha256,
      rowCount: imported.interactions.length,
    },
    ...imported,
  };
}
