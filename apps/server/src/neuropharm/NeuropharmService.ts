import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { ServerConfig } from "../config.ts";
import {
  type NeuropharmAnalysisInput,
  NeuropharmAnalysisResult,
  type NeuropharmCompoundComparisonInput,
  type NeuropharmCompoundComparisonResult,
  type NeuropharmCompoundIdentity,
  type NeuropharmCompoundLookupInput,
  type NeuropharmCompoundLookupResult,
  type NeuropharmDatabaseSource,
  type NeuropharmDatabaseSyncInput,
  type NeuropharmDatabaseSyncResult,
  type NeuropharmBasicsPackInput,
  type NeuropharmBasicsPackResult,
  type NeuropharmLocalDatabaseDownloadInput,
  type NeuropharmLocalDatabaseDownloadResult,
  type NeuropharmLocalDatabaseSnapshot,
  type NeuropharmLocalDatabaseSource,
  type NeuropharmLocalDatabaseStatusInput,
  type NeuropharmLocalDatabaseStatusResult,
  type NeuropharmLocalSearchInput,
  type NeuropharmLocalSearchResult,
  type NeuropharmEvidencePackInput,
  type NeuropharmEvidencePackResult,
  NeuropharmError,
  type NeuropharmEvidenceRecord,
  type NeuropharmGenerateGraphSpecInput,
  type NeuropharmGraphDatum,
  type NeuropharmGraphEdge,
  type NeuropharmGraphNode,
  type NeuropharmGraphSpec,
  type NeuropharmImportDocumentInput,
  type NeuropharmSearchLibraryInput,
  type NeuropharmSearchSourcesInput,
  type NeuropharmSearchSourcesResult,
  type NeuropharmSourceKind,
  type NeuropharmSourceRecord,
  type NeuropharmTargetRecord,
  type NeuropharmInteractionRecord,
  type NeuropharmPublicationRecord,
} from "@t3tools/contracts";
import {
  type NeuropharmCachedSourceRecord,
  fetchNeuropharmDatabaseBundle,
} from "./NeuropharmDatabaseConnectors.ts";
import {
  buildMissingSnapshot,
  downloadLocalDatabase,
  LOCAL_DATABASE_MANIFEST,
} from "./NeuropharmLocalDatabases.ts";
import {
  NEUROPHARM_BASICS_PACK_DOCUMENTS,
  NEUROPHARM_BASICS_PACK_TOPICS,
} from "./NeuropharmBasicsPack.ts";

const EvidenceRow = Schema.Struct({
  evidenceId: Schema.String,
  sourceId: Schema.String,
  source: Schema.String,
  title: Schema.String,
  url: Schema.NullOr(Schema.String),
  citation: Schema.NullOr(Schema.String),
  snippet: Schema.String,
  tags: Schema.String,
  importedAt: Schema.String,
});
type EvidenceRow = typeof EvidenceRow.Type;

const AnalysisRunRow = Schema.Struct({
  analysisId: Schema.String,
  mode: Schema.String,
  title: Schema.String,
  query: Schema.String,
  generatedAt: Schema.String,
  resultJson: Schema.String,
});
type AnalysisRunRow = typeof AnalysisRunRow.Type;

const SourceCacheRow = Schema.Struct({
  sourceRecordId: Schema.String,
  source: Schema.String,
  externalId: Schema.String,
  url: Schema.NullOr(Schema.String),
  title: Schema.String,
  payloadJson: Schema.String,
  fetchedAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
});
type SourceCacheRow = typeof SourceCacheRow.Type;

const CompoundRow = Schema.Struct({
  compoundId: Schema.String,
  preferredName: Schema.String,
  synonymsJson: Schema.String,
  pubchemCid: Schema.NullOr(Schema.String),
  chemblId: Schema.NullOr(Schema.String),
  iupharLigandId: Schema.NullOr(Schema.String),
  molecularFormula: Schema.NullOr(Schema.String),
  canonicalSmiles: Schema.NullOr(Schema.String),
  inchiKey: Schema.NullOr(Schema.String),
  sourceIdsJson: Schema.String,
  updatedAt: Schema.String,
});
type CompoundRow = typeof CompoundRow.Type;

const TargetRow = Schema.Struct({
  targetId: Schema.String,
  name: Schema.String,
  type: Schema.String,
  family: Schema.NullOr(Schema.String),
  organism: Schema.NullOr(Schema.String),
  sourceIdsJson: Schema.String,
  updatedAt: Schema.String,
});
type TargetRow = typeof TargetRow.Type;

const InteractionRow = Schema.Struct({
  interactionId: Schema.String,
  compoundId: Schema.String,
  targetId: Schema.String,
  compoundName: Schema.String,
  targetName: Schema.String,
  source: Schema.String,
  evidenceGrade: Schema.String,
  action: Schema.NullOr(Schema.String),
  measurementType: Schema.NullOr(Schema.String),
  value: Schema.NullOr(Schema.Number),
  relation: Schema.NullOr(Schema.String),
  units: Schema.NullOr(Schema.String),
  assayContext: Schema.NullOr(Schema.String),
  publicationIdsJson: Schema.String,
  sourceIdsJson: Schema.String,
  fetchedAt: Schema.String,
});
type InteractionRow = typeof InteractionRow.Type;

const PublicationRow = Schema.Struct({
  publicationId: Schema.String,
  source: Schema.String,
  title: Schema.String,
  abstract: Schema.NullOr(Schema.String),
  journal: Schema.NullOr(Schema.String),
  year: Schema.NullOr(Schema.Number),
  url: Schema.NullOr(Schema.String),
  sourceIdsJson: Schema.String,
  fetchedAt: Schema.String,
});
type PublicationRow = typeof PublicationRow.Type;

const LocalDatabaseSnapshotRow = Schema.Struct({
  source: Schema.String,
  status: Schema.String,
  title: Schema.String,
  url: Schema.String,
  downloadUrl: Schema.String,
  filePath: Schema.NullOr(Schema.String),
  fileName: Schema.String,
  version: Schema.NullOr(Schema.String),
  downloadedAt: Schema.NullOr(Schema.String),
  importedAt: Schema.NullOr(Schema.String),
  bytes: Schema.NullOr(Schema.Number),
  rowCount: Schema.Number,
  checksumSha256: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
type LocalDatabaseSnapshotRow = typeof LocalDatabaseSnapshotRow.Type;

const decodeTagsJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);
const encodeTagsJson = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeAnalysisResultJson = Schema.encodeSync(Schema.fromJsonString(NeuropharmAnalysisResult));
const encodeStringArrayJson = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeStringArrayJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stableId(prefix: string, parts: ReadonlyArray<string>): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function sourceSearchUrl(source: NeuropharmSourceKind, query: string): string | undefined {
  const encoded = encodeURIComponent(query);
  switch (source) {
    case "chembl":
      return `https://www.ebi.ac.uk/chembl/g/#search_results/all/query=${encoded}`;
    case "pubchem":
      return `https://pubchem.ncbi.nlm.nih.gov/#query=${encoded}`;
    case "iuphar":
      return `https://www.guidetopharmacology.org/GRAC/SearchForward?searchString=${encoded}`;
    case "pubmed":
      return `https://pubmed.ncbi.nlm.nih.gov/?term=${encoded}`;
    default:
      return undefined;
  }
}

function buildSourceRecord(
  source: NeuropharmSourceKind,
  query: string,
  fetchedAt: string,
): NeuropharmSourceRecord {
  const labels: Record<string, string> = {
    chembl: "ChEMBL bioactivity and target search",
    pubchem: "PubChem compound and assay search",
    iuphar: "IUPHAR/BPS Guide to Pharmacology search",
    pubmed: "PubMed literature search",
    url: "Web source record",
    csv: "Imported CSV dataset",
    local: "Local evidence library search",
    user_pdf: "User PDF library",
    user_note: "User note library",
  };
  const url = sourceSearchUrl(source, query);
  return {
    sourceId: stableId("source", [source, query]),
    source,
    title: `${labels[source]}: ${query}`,
    ...(url ? { url } : {}),
    citation: labels[source],
    fetchedAt,
    tags: [source, "neuropharmacology"],
    summary:
      "Use this source as evidence context. Values should be treated as source-derived only after opening/importing the referenced record.",
  };
}

function parseTagsJson(value: string): string[] {
  return [...Option.getOrElse(decodeTagsJson(value), () => [])];
}

function parseStringArrayJson(value: string): string[] {
  return [...Option.getOrElse(decodeStringArrayJson(value), () => [])];
}

function toEvidenceRecord(row: EvidenceRow): NeuropharmEvidenceRecord {
  return {
    evidenceId: row.evidenceId,
    sourceId: row.sourceId,
    source: row.source as NeuropharmEvidenceRecord["source"],
    title: row.title,
    ...(row.url ? { url: row.url } : {}),
    ...(row.citation ? { citation: row.citation } : {}),
    snippet: row.snippet,
    tags: parseTagsJson(row.tags),
    importedAt: row.importedAt,
  };
}

function toCompound(row: CompoundRow): NeuropharmCompoundIdentity {
  return {
    compoundId: row.compoundId,
    preferredName: row.preferredName,
    synonyms: parseStringArrayJson(row.synonymsJson),
    ...(row.pubchemCid ? { pubchemCid: row.pubchemCid } : {}),
    ...(row.chemblId ? { chemblId: row.chemblId } : {}),
    ...(row.iupharLigandId ? { iupharLigandId: row.iupharLigandId } : {}),
    ...(row.molecularFormula ? { molecularFormula: row.molecularFormula } : {}),
    ...(row.canonicalSmiles ? { canonicalSmiles: row.canonicalSmiles } : {}),
    ...(row.inchiKey ? { inchiKey: row.inchiKey } : {}),
    sourceIds: parseStringArrayJson(row.sourceIdsJson),
  };
}

function toTarget(row: TargetRow): NeuropharmTargetRecord {
  return {
    targetId: row.targetId,
    name: row.name,
    type: row.type,
    ...(row.family ? { family: row.family } : {}),
    ...(row.organism ? { organism: row.organism } : {}),
    sourceIds: parseStringArrayJson(row.sourceIdsJson),
  };
}

function toInteraction(row: InteractionRow): NeuropharmInteractionRecord {
  return {
    interactionId: row.interactionId,
    compoundId: row.compoundId,
    targetId: row.targetId,
    compoundName: row.compoundName,
    targetName: row.targetName,
    source: row.source as NeuropharmInteractionRecord["source"],
    evidenceGrade: row.evidenceGrade as NeuropharmInteractionRecord["evidenceGrade"],
    ...(row.action ? { action: row.action } : {}),
    ...(row.measurementType ? { measurementType: row.measurementType } : {}),
    ...(row.value !== null ? { value: row.value } : {}),
    ...(row.relation ? { relation: row.relation } : {}),
    ...(row.units ? { units: row.units } : {}),
    ...(row.assayContext ? { assayContext: row.assayContext } : {}),
    publicationIds: parseStringArrayJson(row.publicationIdsJson),
    sourceIds: parseStringArrayJson(row.sourceIdsJson),
    fetchedAt: row.fetchedAt,
  };
}

function toPublication(row: PublicationRow): NeuropharmPublicationRecord {
  return {
    publicationId: row.publicationId,
    source: "pubmed",
    title: row.title,
    ...(row.abstract ? { abstract: row.abstract } : {}),
    ...(row.journal ? { journal: row.journal } : {}),
    ...(row.year !== null ? { year: row.year } : {}),
    ...(row.url ? { url: row.url } : {}),
    sourceIds: parseStringArrayJson(row.sourceIdsJson),
    fetchedAt: row.fetchedAt,
  };
}

function toLocalSnapshot(row: LocalDatabaseSnapshotRow): NeuropharmLocalDatabaseSnapshot {
  return {
    source: row.source as NeuropharmLocalDatabaseSnapshot["source"],
    status: row.status as NeuropharmLocalDatabaseSnapshot["status"],
    title: row.title,
    url: row.url,
    downloadUrl: row.downloadUrl,
    ...(row.filePath ? { filePath: row.filePath } : {}),
    fileName: row.fileName,
    ...(row.version ? { version: row.version } : {}),
    ...(row.downloadedAt ? { downloadedAt: row.downloadedAt } : {}),
    ...(row.importedAt ? { importedAt: row.importedAt } : {}),
    ...(row.bytes !== null ? { bytes: row.bytes } : {}),
    rowCount: row.rowCount,
    ...(row.checksumSha256 ? { checksumSha256: row.checksumSha256 } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function defaultGraphData(kind: NeuropharmGraphSpec["kind"]): NeuropharmGraphDatum[] {
  switch (kind) {
    case "dose_response":
      return [
        { label: "low", value: 20, unit: "% effect" },
        { label: "medium", value: 55, unit: "% effect" },
        { label: "high", value: 82, unit: "% effect" },
      ];
    case "receptor_selectivity_radar":
      return [
        { label: "5-HT2A", value: 78 },
        { label: "D2", value: 24 },
        { label: "NET", value: 40 },
        { label: "DAT", value: 36 },
        { label: "SERT", value: 52 },
      ];
    case "pk_timeline":
      return [
        { label: "onset", value: 0.5, unit: "h" },
        { label: "tmax", value: 2, unit: "h" },
        { label: "half-life", value: 6, unit: "h" },
      ];
    case "interaction_risk_heatmap":
      return [
        { label: "serotonergic", value: 72 },
        { label: "stimulant", value: 58 },
        { label: "sedative", value: 34 },
        { label: "CYP", value: 49 },
      ];
    default:
      return [
        { label: "evidence", value: 65 },
        { label: "uncertainty", value: 35 },
        { label: "risk", value: 45 },
      ];
  }
}

function graphKindsForMode(mode: NeuropharmAnalysisInput["mode"]): NeuropharmGraphSpec["kind"][] {
  switch (mode) {
    case "compound_profile":
      return ["receptor_selectivity_radar", "molecule_property_card", "admet_radar"];
    case "receptor_explorer":
      return ["target_network", "effect_size_forest", "task_domain_matrix"];
    case "stack_checker":
      return ["interaction_risk_heatmap", "pk_timeline", "inverted_u_curve"];
  }
}

function graphSpecFor(kind: NeuropharmGraphSpec["kind"], title: string, query: string) {
  return {
    kind,
    title: `${title}: ${kind.replaceAll("_", " ")}`,
    xLabel: kind === "pk_timeline" ? "Time" : "Domain",
    yLabel: kind === "pk_timeline" ? "Hours" : "Relative score",
    data: defaultGraphData(kind),
    notes: [
      `Generated as a standardized research template for ${query}.`,
      "Replace template values with extracted study values before treating the figure as publication-grade.",
    ],
  } satisfies NeuropharmGraphSpec;
}

function graphSpecForInteractions(
  title: string,
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmGraphSpec {
  const gradeScore: Record<NeuropharmInteractionRecord["evidenceGrade"], number> = {
    measured: 90,
    inferred: 55,
    speculative: 25,
  };
  return {
    kind: "target_network",
    title,
    xLabel: "Target",
    yLabel: "Evidence grade score",
    data: interactions.slice(0, 12).map((interaction) => ({
      label: interaction.targetName,
      value: gradeScore[interaction.evidenceGrade],
      group: interaction.compoundName,
      unit: interaction.evidenceGrade,
    })),
    notes: [
      "Measured values are database-backed assay/literature records when available.",
      "Inferred and speculative entries are shown for research triage, not clinical decision-making.",
    ],
  };
}

function evidenceGradeScore(grade: NeuropharmInteractionRecord["evidenceGrade"]): number {
  switch (grade) {
    case "measured":
      return 92;
    case "inferred":
      return 62;
    case "speculative":
      return 28;
  }
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function shortTargetLabel(value: string): string {
  return value
    .replace(/\b(muscarinic acetylcholine receptor)\b/gi, "mAChR")
    .replace(/\b(dopamine transporter)\b/gi, "DAT")
    .replace(/\b(norepinephrine transporter)\b/gi, "NET")
    .replace(/\b(sigma-1 receptor)\b/gi, "S1R")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 56);
}

function interactionStrength(interaction: NeuropharmInteractionRecord): number {
  const base = evidenceGradeScore(interaction.evidenceGrade);
  if (typeof interaction.value !== "number") {
    return base;
  }
  const units = interaction.units?.toLowerCase() ?? "";
  const measurement = interaction.measurementType?.toLowerCase() ?? "";
  const looksLikeAffinity =
    units.includes("nm") ||
    units.includes("ki") ||
    units.includes("ic50") ||
    measurement.includes("ki") ||
    measurement.includes("ic50") ||
    measurement.includes("affinity");
  if (!looksLikeAffinity || interaction.value <= 0) {
    return base;
  }
  const affinityScore = 100 - Math.log10(Math.max(interaction.value, 1)) * 20;
  return clampScore(base * 0.55 + affinityScore * 0.45);
}

function uniqueInteractions(
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmInteractionRecord[] {
  return [
    ...new Map(
      interactions.map((interaction) => [interaction.interactionId, interaction]),
    ).values(),
  ];
}

function uniqueEvidence(
  evidence: ReadonlyArray<NeuropharmEvidenceRecord>,
): NeuropharmEvidenceRecord[] {
  return [...new Map(evidence.map((record) => [record.evidenceId, record])).values()];
}

function interactionRadarSpec(
  title: string,
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmGraphSpec | undefined {
  const data = uniqueInteractions(interactions)
    .slice(0, 18)
    .map((interaction) => ({
      label: shortTargetLabel(interaction.targetName),
      value: interactionStrength(interaction),
      group: interaction.compoundName,
      unit: interaction.evidenceGrade,
    }));
  if (data.length === 0) return undefined;
  return {
    kind: "receptor_selectivity_radar",
    title: `${title}: receptor/transporter selectivity`,
    xLabel: "Target",
    yLabel: "Evidence-weighted score",
    data,
    notes: [
      "Scores combine local database evidence grade with available affinity-like measurements.",
      "Axes are normalized for comparison; inspect raw interaction rows before quantitative interpretation.",
    ],
  };
}

function interactionRiskDomain(interaction: NeuropharmInteractionRecord): string {
  const text =
    `${interaction.targetName} ${interaction.action ?? ""} ${interaction.measurementType ?? ""}`.toLowerCase();
  if (
    text.includes("dopamine") ||
    text.includes("norepinephrine") ||
    text.includes("dat") ||
    text.includes("net")
  ) {
    return "catecholamine load";
  }
  if (text.includes("muscarinic") || text.includes("chrm") || text.includes("acetylcholine")) {
    return "cholinergic load";
  }
  if (text.includes("sigma")) {
    return "sigma-1 modulation";
  }
  if (text.includes("serotonin") || text.includes("5-ht")) {
    return "serotonergic load";
  }
  if (text.includes("cyp") || text.includes("transporter")) {
    return "PK/transporter uncertainty";
  }
  return "mechanism uncertainty";
}

function interactionHeatmapSpec(
  title: string,
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmGraphSpec | undefined {
  const grouped = new Map<string, NeuropharmGraphDatum>();
  for (const interaction of uniqueInteractions(interactions)) {
    const label = interactionRiskDomain(interaction);
    const key = `${interaction.compoundName}|${label}`;
    const current = grouped.get(key);
    const value = clampScore(interactionStrength(interaction) * 0.72);
    grouped.set(key, {
      label,
      value: Math.max(current?.value ?? 0, value),
      group: interaction.compoundName,
      unit: interaction.evidenceGrade,
    });
  }
  const data = [...grouped.values()].slice(0, 24);
  if (data.length === 0) return undefined;
  return {
    kind: "interaction_risk_heatmap",
    title: `${title}: interaction and mechanism overlap`,
    xLabel: "Mechanism",
    yLabel: "Compound",
    data,
    notes: [
      "Heatmap values are triage scores derived from local interaction classes, not clinical risk probabilities.",
      "Use the highest-scoring cells to decide which mechanisms need primary-source review.",
    ],
  };
}

function taskDomainFromInteraction(interaction: NeuropharmInteractionRecord): string {
  const text = `${interaction.targetName} ${interaction.action ?? ""}`.toLowerCase();
  if (
    text.includes("dopamine") ||
    text.includes("norepinephrine") ||
    text.includes("dat") ||
    text.includes("net")
  ) {
    return "attention/vigilance";
  }
  if (text.includes("muscarinic") || text.includes("chrm1") || text.includes("m1")) {
    return "encoding/working memory";
  }
  if (text.includes("sigma")) {
    return "stress resilience/plasticity";
  }
  if (text.includes("glutamate") || text.includes("nmda") || text.includes("ampa")) {
    return "learning/plasticity";
  }
  return "translation uncertainty";
}

function interactionTaskMatrixSpec(
  title: string,
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmGraphSpec | undefined {
  const data = uniqueInteractions(interactions)
    .slice(0, 24)
    .map((interaction) => ({
      label: taskDomainFromInteraction(interaction),
      value: clampScore(interactionStrength(interaction) * 0.82),
      group: interaction.compoundName,
      unit: interaction.evidenceGrade,
    }));
  if (data.length === 0) return undefined;
  return {
    kind: "task_domain_matrix",
    title: `${title}: cognition task-domain hypotheses`,
    xLabel: "Cognition domain",
    yLabel: "Compound",
    data,
    notes: [
      "Domains are mechanistic hypotheses mapped from receptor/transporter rows.",
      "Human cognitive efficacy remains separate from receptor plausibility unless human evidence is attached.",
    ],
  };
}

function interactionGraphSpecs(
  title: string,
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmGraphSpec[] {
  const unique = uniqueInteractions(interactions);
  if (unique.length === 0) {
    return [];
  }
  return [
    graphSpecForInteractions(`${title}: local interaction evidence map`, unique),
    interactionRadarSpec(title, unique),
    interactionHeatmapSpec(title, unique),
    interactionTaskMatrixSpec(title, unique),
  ].filter((spec): spec is NeuropharmGraphSpec => Boolean(spec));
}

function dedupeGraphSpecs(specs: ReadonlyArray<NeuropharmGraphSpec>): NeuropharmGraphSpec[] {
  return [...new Map(specs.map((spec) => [`${spec.kind}|${spec.title}`, spec])).values()];
}

function graphNodesForInteractions(
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmGraphNode[] {
  const unique = uniqueInteractions(interactions);
  return [
    ...unique
      .map((interaction) => node("compound", interaction.compoundName, "moderate", ["local-db"]))
      .slice(0, 8),
    ...unique
      .map((interaction) =>
        node(
          "target",
          shortTargetLabel(interaction.targetName),
          interaction.evidenceGrade === "measured" ? "high" : "moderate",
          ["local-db", interaction.evidenceGrade],
        ),
      )
      .slice(0, 12),
  ];
}

function buildDatabaseGraphEdges(
  nodes: ReadonlyArray<NeuropharmGraphNode>,
  interactions: ReadonlyArray<NeuropharmInteractionRecord>,
): NeuropharmGraphEdge[] {
  const byLabel = new Map(nodes.map((entry) => [entry.label.toLowerCase(), entry]));
  return uniqueInteractions(interactions)
    .slice(0, 24)
    .flatMap((interaction) => {
      const compound = byLabel.get(interaction.compoundName.toLowerCase());
      const target = byLabel.get(shortTargetLabel(interaction.targetName).toLowerCase());
      if (!compound || !target) return [];
      return [
        {
          edgeId: stableId("edge", [compound.nodeId, target.nodeId, interaction.interactionId]),
          fromNodeId: compound.nodeId,
          toNodeId: target.nodeId,
          relation: interaction.action ?? interaction.measurementType ?? "local DB interaction",
          confidence: interaction.evidenceGrade === "measured" ? "high" : "moderate",
          evidenceIds: [],
        } satisfies NeuropharmGraphEdge,
      ];
    });
}

function analysisSearchQueries(input: NeuropharmAnalysisInput): string[] {
  return [normalizeQuery(input.query), ...(input.compounds ?? []), ...(input.targets ?? [])]
    .map(normalizeQuery)
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)
    .slice(0, 8);
}

function compoundSeedsForAnalysis(input: NeuropharmAnalysisInput): string[] {
  const explicit = input.compounds?.map(normalizeQuery).filter(Boolean) ?? [];
  if (explicit.length > 0) return [...new Set(explicit)].slice(0, 4);
  const query = normalizeQuery(input.query);
  const matches = query.match(/\b(AF-?710B|ANAVEX3?-?71|methylphenidate|modafinil|ketamine)\b/gi);
  return [...new Set((matches ?? []).map(normalizeQuery))].slice(0, 4);
}

function analysisTitle(input: NeuropharmAnalysisInput): string {
  const modeLabel = input.mode.replaceAll("_", " ");
  return `${modeLabel}: ${input.query}`;
}

function node(
  kind: NeuropharmGraphNode["kind"],
  label: string,
  confidence: NeuropharmGraphNode["confidence"],
  tags: ReadonlyArray<string>,
): NeuropharmGraphNode {
  return {
    nodeId: stableId("node", [kind, label, ...tags]),
    kind,
    label,
    confidence,
    tags: [...tags],
  };
}

function buildGraphNodes(input: NeuropharmAnalysisInput): NeuropharmGraphNode[] {
  const query = normalizeQuery(input.query);
  const compounds = input.compounds?.length ? input.compounds : [query];
  const targets = input.targets?.length ? input.targets : ["primary target hypothesis"];
  const modeNode =
    input.mode === "stack_checker"
      ? node("stack", query, "low", ["stack", "interaction"])
      : input.mode === "receptor_explorer"
        ? node("target", query, "moderate", ["receptor", "target"])
        : node("compound", compounds[0] ?? query, "moderate", ["compound"]);

  return [
    modeNode,
    ...compounds.slice(0, 6).map((compound) => node("compound", compound, "moderate", ["input"])),
    ...targets.slice(0, 8).map((target) => node("target", target, "low", ["target"])),
    node("risk", "interaction and contraindication screen", "low", ["safety"]),
    node("report", `${query} evidence report`, "moderate", ["artifact"]),
  ].filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.nodeId === candidate.nodeId) === index,
  );
}

function buildGraphEdges(
  nodes: ReadonlyArray<NeuropharmGraphNode>,
  evidence: ReadonlyArray<NeuropharmEvidenceRecord>,
): NeuropharmGraphEdge[] {
  const root = nodes[0];
  if (!root) {
    return [];
  }
  const evidenceIds = evidence.slice(0, 5).map((record) => record.evidenceId);
  return nodes.slice(1).map((target) => ({
    edgeId: stableId("edge", [root.nodeId, target.nodeId, target.kind]),
    fromNodeId: root.nodeId,
    toNodeId: target.nodeId,
    relation:
      target.kind === "risk"
        ? "requires safety review"
        : target.kind === "report"
          ? "summarized in"
          : "has hypothesized relationship with",
    confidence: evidence.length >= 3 ? "moderate" : "low",
    evidenceIds,
  }));
}

function buildMermaid(input: NeuropharmAnalysisInput): string {
  const query = normalizeQuery(input.query)
    .replace(/["[\]{}<>]/g, " ")
    .replace(/\s+/g, " ");
  if (input.mode === "stack_checker") {
    return `flowchart LR
  Stack["${query} stack"] --> CYP["CYP / transporter review"]
  Stack --> Serotonin["Serotonergic load"]
  Stack --> Cardio["Cardiovascular load"]
  CYP --> Risk["interaction risk flags"]
  Serotonin --> Risk
  Cardio --> Risk`;
  }
  if (input.mode === "receptor_explorer") {
    return `flowchart LR
  Target["${query}"] --> Signaling["signaling bias / coupling"]
  Target --> Ligands["ligand classes"]
  Signaling --> Cognition["cognition domains"]
  Ligands --> Evidence["study evidence"]`;
  }
  return `flowchart LR
  Compound["${query}"] --> Targets["receptor / transporter targets"]
  Compound --> PK["PK/PD timeline"]
  Targets --> Effects["effect hypotheses"]
  PK --> Risk["risk and interaction flags"]
  Effects --> Report["evidence report"]`;
}

function latexForAnalysis(
  input: NeuropharmAnalysisInput,
  evidence: ReadonlyArray<NeuropharmEvidenceRecord>,
): NeuropharmAnalysisResult["latex"] {
  const citations = evidence.flatMap((record) => record.citation ?? record.url ?? record.title);
  const title = analysisTitle(input);
  return {
    title,
    citations,
    latex: `\\section{${title}}
\\subsection{Evidence posture}
This report is a research-only synthesis. Claims should be interpreted as evidence-weighted hypotheses unless directly supported by cited human data.

\\subsection{Key questions}
\\begin{itemize}
  \\item What receptor, transporter, pathway, and PK/PD mechanisms are plausible?
  \\item Which claims are human, animal, in-vitro, in-silico, or anecdotal?
  \\item Which interaction and safety flags require conservative interpretation?
\\end{itemize}

\\subsection{Evidence count}
Imported records used: ${evidence.length}.
`,
  };
}

export interface NeuropharmServiceShape {
  readonly searchSources: (
    input: NeuropharmSearchSourcesInput,
  ) => Effect.Effect<NeuropharmSearchSourcesResult, NeuropharmError>;
  readonly importDocument: (
    input: NeuropharmImportDocumentInput,
  ) => Effect.Effect<NeuropharmEvidenceRecord, NeuropharmError>;
  readonly installBasicsPack: (
    input: NeuropharmBasicsPackInput,
  ) => Effect.Effect<NeuropharmBasicsPackResult, NeuropharmError>;
  readonly searchLibrary: (
    input: NeuropharmSearchLibraryInput,
  ) => Effect.Effect<ReadonlyArray<NeuropharmEvidenceRecord>, NeuropharmError>;
  readonly buildEvidencePack: (
    input: NeuropharmEvidencePackInput,
  ) => Effect.Effect<NeuropharmEvidencePackResult, NeuropharmError>;
  readonly generateGraphSpec: (
    input: NeuropharmGenerateGraphSpecInput,
  ) => Effect.Effect<NeuropharmGraphSpec, NeuropharmError>;
  readonly analyze: (
    input: NeuropharmAnalysisInput,
  ) => Effect.Effect<NeuropharmAnalysisResult, NeuropharmError>;
  readonly syncDatabases: (
    input: NeuropharmDatabaseSyncInput,
  ) => Effect.Effect<NeuropharmDatabaseSyncResult, NeuropharmError>;
  readonly lookupCompound: (
    input: NeuropharmCompoundLookupInput,
  ) => Effect.Effect<NeuropharmCompoundLookupResult, NeuropharmError>;
  readonly compareCompounds: (
    input: NeuropharmCompoundComparisonInput,
  ) => Effect.Effect<NeuropharmCompoundComparisonResult, NeuropharmError>;
  readonly downloadDatabases: (
    input: NeuropharmLocalDatabaseDownloadInput,
  ) => Effect.Effect<NeuropharmLocalDatabaseDownloadResult, NeuropharmError>;
  readonly databaseStatus: (
    input: NeuropharmLocalDatabaseStatusInput,
  ) => Effect.Effect<NeuropharmLocalDatabaseStatusResult, NeuropharmError>;
  readonly searchLocalReceptors: (
    input: NeuropharmLocalSearchInput,
  ) => Effect.Effect<NeuropharmLocalSearchResult, NeuropharmError>;
  readonly searchLocalInteractions: (
    input: NeuropharmLocalSearchInput,
  ) => Effect.Effect<NeuropharmLocalSearchResult, NeuropharmError>;
}

export class NeuropharmService extends Context.Service<NeuropharmService, NeuropharmServiceShape>()(
  "t3/neuropharm/NeuropharmService",
) {}

const makeService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const serverConfig = yield* ServerConfig;
  const localDatabaseBaseDirectory = `${serverConfig.stateDir}/neuropharm/databases`;

  const insertEvidence = SqlSchema.void({
    Request: EvidenceRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_evidence (
        evidence_id,
        source_id,
        source,
        title,
        url,
        citation,
        snippet,
        tags_json,
        imported_at
      )
      VALUES (
        ${row.evidenceId},
        ${row.sourceId},
        ${row.source},
        ${row.title},
        ${row.url},
        ${row.citation},
        ${row.snippet},
        ${row.tags},
        ${row.importedAt}
      )
      ON CONFLICT (evidence_id)
      DO UPDATE SET
        source_id = excluded.source_id,
        source = excluded.source,
        title = excluded.title,
        url = excluded.url,
        citation = excluded.citation,
        snippet = excluded.snippet,
        tags_json = excluded.tags_json,
        imported_at = excluded.imported_at
    `,
  });

  const findEvidence = SqlSchema.findAll({
    Request: Schema.Struct({ query: Schema.String, limit: Schema.Number }),
    Result: EvidenceRow,
    execute: ({ query, limit }) => {
      const pattern = `%${query}%`;
      return sql`
        SELECT
          evidence_id AS "evidenceId",
          source_id AS "sourceId",
          source,
          title,
          url,
          citation,
          snippet,
          tags_json AS "tags",
          imported_at AS "importedAt"
        FROM neuropharm_evidence
        WHERE title LIKE ${pattern}
          OR snippet LIKE ${pattern}
          OR tags_json LIKE ${pattern}
        ORDER BY imported_at DESC, title ASC
        LIMIT ${limit}
      `;
    },
  });

  const insertAnalysisRun = SqlSchema.void({
    Request: AnalysisRunRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_analysis_runs (
        analysis_id,
        mode,
        title,
        query,
        generated_at,
        result_json
      )
      VALUES (
        ${row.analysisId},
        ${row.mode},
        ${row.title},
        ${row.query},
        ${row.generatedAt},
        ${row.resultJson}
      )
      ON CONFLICT (analysis_id)
      DO UPDATE SET
        mode = excluded.mode,
        title = excluded.title,
        query = excluded.query,
        generated_at = excluded.generated_at,
        result_json = excluded.result_json
    `,
  });

  const upsertSourceCache = SqlSchema.void({
    Request: SourceCacheRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_source_cache (
        source_record_id,
        source,
        external_id,
        url,
        title,
        payload_json,
        fetched_at,
        expires_at
      )
      VALUES (
        ${row.sourceRecordId},
        ${row.source},
        ${row.externalId},
        ${row.url},
        ${row.title},
        ${row.payloadJson},
        ${row.fetchedAt},
        ${row.expiresAt}
      )
      ON CONFLICT (source_record_id)
      DO UPDATE SET
        source = excluded.source,
        external_id = excluded.external_id,
        url = excluded.url,
        title = excluded.title,
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `,
  });

  const upsertCompound = SqlSchema.void({
    Request: CompoundRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_compounds (
        compound_id,
        preferred_name,
        synonyms_json,
        pubchem_cid,
        chembl_id,
        iuphar_ligand_id,
        molecular_formula,
        canonical_smiles,
        inchi_key,
        source_ids_json,
        updated_at
      )
      VALUES (
        ${row.compoundId},
        ${row.preferredName},
        ${row.synonymsJson},
        ${row.pubchemCid},
        ${row.chemblId},
        ${row.iupharLigandId},
        ${row.molecularFormula},
        ${row.canonicalSmiles},
        ${row.inchiKey},
        ${row.sourceIdsJson},
        ${row.updatedAt}
      )
      ON CONFLICT (compound_id)
      DO UPDATE SET
        preferred_name = excluded.preferred_name,
        synonyms_json = excluded.synonyms_json,
        pubchem_cid = COALESCE(excluded.pubchem_cid, neuropharm_compounds.pubchem_cid),
        chembl_id = COALESCE(excluded.chembl_id, neuropharm_compounds.chembl_id),
        iuphar_ligand_id = COALESCE(excluded.iuphar_ligand_id, neuropharm_compounds.iuphar_ligand_id),
        molecular_formula = COALESCE(excluded.molecular_formula, neuropharm_compounds.molecular_formula),
        canonical_smiles = COALESCE(excluded.canonical_smiles, neuropharm_compounds.canonical_smiles),
        inchi_key = COALESCE(excluded.inchi_key, neuropharm_compounds.inchi_key),
        source_ids_json = excluded.source_ids_json,
        updated_at = excluded.updated_at
    `,
  });

  const upsertTarget = SqlSchema.void({
    Request: TargetRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_targets (
        target_id,
        name,
        type,
        family,
        organism,
        source_ids_json,
        updated_at
      )
      VALUES (
        ${row.targetId},
        ${row.name},
        ${row.type},
        ${row.family},
        ${row.organism},
        ${row.sourceIdsJson},
        ${row.updatedAt}
      )
      ON CONFLICT (target_id)
      DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        family = COALESCE(excluded.family, neuropharm_targets.family),
        organism = COALESCE(excluded.organism, neuropharm_targets.organism),
        source_ids_json = excluded.source_ids_json,
        updated_at = excluded.updated_at
    `,
  });

  const upsertInteraction = SqlSchema.void({
    Request: InteractionRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_interactions (
        interaction_id,
        compound_id,
        target_id,
        compound_name,
        target_name,
        source,
        evidence_grade,
        action,
        measurement_type,
        value,
        relation,
        units,
        assay_context,
        publication_ids_json,
        source_ids_json,
        fetched_at
      )
      VALUES (
        ${row.interactionId},
        ${row.compoundId},
        ${row.targetId},
        ${row.compoundName},
        ${row.targetName},
        ${row.source},
        ${row.evidenceGrade},
        ${row.action},
        ${row.measurementType},
        ${row.value},
        ${row.relation},
        ${row.units},
        ${row.assayContext},
        ${row.publicationIdsJson},
        ${row.sourceIdsJson},
        ${row.fetchedAt}
      )
      ON CONFLICT (interaction_id)
      DO UPDATE SET
        compound_id = excluded.compound_id,
        target_id = excluded.target_id,
        compound_name = excluded.compound_name,
        target_name = excluded.target_name,
        source = excluded.source,
        evidence_grade = excluded.evidence_grade,
        action = excluded.action,
        measurement_type = excluded.measurement_type,
        value = excluded.value,
        relation = excluded.relation,
        units = excluded.units,
        assay_context = excluded.assay_context,
        publication_ids_json = excluded.publication_ids_json,
        source_ids_json = excluded.source_ids_json,
        fetched_at = excluded.fetched_at
    `,
  });

  const upsertPublication = SqlSchema.void({
    Request: PublicationRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_publications (
        publication_id,
        source,
        title,
        abstract,
        journal,
        year,
        url,
        source_ids_json,
        fetched_at
      )
      VALUES (
        ${row.publicationId},
        ${row.source},
        ${row.title},
        ${row.abstract},
        ${row.journal},
        ${row.year},
        ${row.url},
        ${row.sourceIdsJson},
        ${row.fetchedAt}
      )
      ON CONFLICT (publication_id)
      DO UPDATE SET
        source = excluded.source,
        title = excluded.title,
        abstract = excluded.abstract,
        journal = excluded.journal,
        year = excluded.year,
        url = excluded.url,
        source_ids_json = excluded.source_ids_json,
        fetched_at = excluded.fetched_at
    `,
  });

  const upsertLocalSnapshot = SqlSchema.void({
    Request: LocalDatabaseSnapshotRow,
    execute: (row) => sql`
      INSERT INTO neuropharm_local_database_snapshots (
        source,
        status,
        title,
        url,
        download_url,
        file_path,
        file_name,
        version,
        downloaded_at,
        imported_at,
        bytes,
        row_count,
        checksum_sha256,
        error
      )
      VALUES (
        ${row.source},
        ${row.status},
        ${row.title},
        ${row.url},
        ${row.downloadUrl},
        ${row.filePath},
        ${row.fileName},
        ${row.version},
        ${row.downloadedAt},
        ${row.importedAt},
        ${row.bytes},
        ${row.rowCount},
        ${row.checksumSha256},
        ${row.error}
      )
      ON CONFLICT (source)
      DO UPDATE SET
        status = excluded.status,
        title = excluded.title,
        url = excluded.url,
        download_url = excluded.download_url,
        file_path = excluded.file_path,
        file_name = excluded.file_name,
        version = excluded.version,
        downloaded_at = excluded.downloaded_at,
        imported_at = excluded.imported_at,
        bytes = excluded.bytes,
        row_count = excluded.row_count,
        checksum_sha256 = excluded.checksum_sha256,
        error = excluded.error
    `,
  });

  const findLocalSnapshots = SqlSchema.findAll({
    Request: Schema.Struct({ sources: Schema.Array(Schema.String) }),
    Result: LocalDatabaseSnapshotRow,
    execute: ({ sources }) => sql`
      SELECT
        source,
        status,
        title,
        url,
        download_url AS "downloadUrl",
        file_path AS "filePath",
        file_name AS "fileName",
        version,
        downloaded_at AS "downloadedAt",
        imported_at AS "importedAt",
        bytes,
        row_count AS "rowCount",
        checksum_sha256 AS "checksumSha256",
        error
      FROM neuropharm_local_database_snapshots
      WHERE source IN ${sql.in(sources)}
      ORDER BY source ASC
    `,
  });

  const findCompoundRows = SqlSchema.findAll({
    Request: Schema.Struct({ query: Schema.String, limit: Schema.Number }),
    Result: CompoundRow,
    execute: ({ query, limit }) => {
      const pattern = `%${query}%`;
      return sql`
        SELECT
          compound_id AS "compoundId",
          preferred_name AS "preferredName",
          synonyms_json AS "synonymsJson",
          pubchem_cid AS "pubchemCid",
          chembl_id AS "chemblId",
          iuphar_ligand_id AS "iupharLigandId",
          molecular_formula AS "molecularFormula",
          canonical_smiles AS "canonicalSmiles",
          inchi_key AS "inchiKey",
          source_ids_json AS "sourceIdsJson",
          updated_at AS "updatedAt"
        FROM neuropharm_compounds
        WHERE preferred_name LIKE ${pattern}
          OR synonyms_json LIKE ${pattern}
          OR pubchem_cid LIKE ${pattern}
          OR chembl_id LIKE ${pattern}
          OR iuphar_ligand_id LIKE ${pattern}
        ORDER BY preferred_name ASC
        LIMIT ${limit}
      `;
    },
  });

  const findInteractionsByCompoundIds = SqlSchema.findAll({
    Request: Schema.Struct({ compoundIds: Schema.Array(Schema.String) }),
    Result: InteractionRow,
    execute: ({ compoundIds }) => sql`
      SELECT
        interaction_id AS "interactionId",
        compound_id AS "compoundId",
        target_id AS "targetId",
        compound_name AS "compoundName",
        target_name AS "targetName",
        source,
        evidence_grade AS "evidenceGrade",
        action,
        measurement_type AS "measurementType",
        value,
        relation,
        units,
        assay_context AS "assayContext",
        publication_ids_json AS "publicationIdsJson",
        source_ids_json AS "sourceIdsJson",
        fetched_at AS "fetchedAt"
      FROM neuropharm_interactions
      WHERE compound_id IN ${sql.in(compoundIds)}
      ORDER BY evidence_grade ASC, target_name ASC
    `,
  });

  const findInteractionsByQuery = SqlSchema.findAll({
    Request: Schema.Struct({ query: Schema.String, limit: Schema.Number }),
    Result: InteractionRow,
    execute: ({ query, limit }) => {
      const pattern = `%${query}%`;
      return sql`
        SELECT
          interaction_id AS "interactionId",
          compound_id AS "compoundId",
          target_id AS "targetId",
          compound_name AS "compoundName",
          target_name AS "targetName",
          source,
          evidence_grade AS "evidenceGrade",
          action,
          measurement_type AS "measurementType",
          value,
          relation,
          units,
          assay_context AS "assayContext",
          publication_ids_json AS "publicationIdsJson",
          source_ids_json AS "sourceIdsJson",
          fetched_at AS "fetchedAt"
        FROM neuropharm_interactions
        WHERE compound_name LIKE ${pattern}
          OR target_name LIKE ${pattern}
          OR action LIKE ${pattern}
          OR assay_context LIKE ${pattern}
        ORDER BY evidence_grade ASC, target_name ASC
        LIMIT ${limit}
      `;
    },
  });

  const findTargetsByQuery = SqlSchema.findAll({
    Request: Schema.Struct({ query: Schema.String, limit: Schema.Number }),
    Result: TargetRow,
    execute: ({ query, limit }) => {
      const pattern = `%${query}%`;
      return sql`
        SELECT
          target_id AS "targetId",
          name,
          type,
          family,
          organism,
          source_ids_json AS "sourceIdsJson",
          updated_at AS "updatedAt"
        FROM neuropharm_targets
        WHERE name LIKE ${pattern}
          OR type LIKE ${pattern}
          OR family LIKE ${pattern}
          OR organism LIKE ${pattern}
        ORDER BY name ASC
        LIMIT ${limit}
      `;
    },
  });

  const findTargetsByIds = SqlSchema.findAll({
    Request: Schema.Struct({ targetIds: Schema.Array(Schema.String) }),
    Result: TargetRow,
    execute: ({ targetIds }) => sql`
      SELECT
        target_id AS "targetId",
        name,
        type,
        family,
        organism,
        source_ids_json AS "sourceIdsJson",
        updated_at AS "updatedAt"
      FROM neuropharm_targets
      WHERE target_id IN ${sql.in(targetIds)}
      ORDER BY name ASC
    `,
  });

  const findPublicationsByIds = SqlSchema.findAll({
    Request: Schema.Struct({ publicationIds: Schema.Array(Schema.String) }),
    Result: PublicationRow,
    execute: ({ publicationIds }) => sql`
      SELECT
        publication_id AS "publicationId",
        source,
        title,
        abstract,
        journal,
        year,
        url,
        source_ids_json AS "sourceIdsJson",
        fetched_at AS "fetchedAt"
      FROM neuropharm_publications
      WHERE publication_id IN ${sql.in(publicationIds)}
      ORDER BY year DESC, title ASC
    `,
  });

  const persistSourceCache = (record: NeuropharmCachedSourceRecord) =>
    upsertSourceCache({
      sourceRecordId: record.sourceRecordId,
      source: record.source,
      externalId: record.externalId,
      url: record.url ?? null,
      title: record.title,
      payloadJson: JSON.stringify(record.payload),
      fetchedAt: record.fetchedAt,
      expiresAt: null,
    });

  const persistCompound = (compound: NeuropharmCompoundIdentity, updatedAt: string) =>
    upsertCompound({
      compoundId: compound.compoundId,
      preferredName: compound.preferredName,
      synonymsJson: encodeStringArrayJson(compound.synonyms),
      pubchemCid: compound.pubchemCid ?? null,
      chemblId: compound.chemblId ?? null,
      iupharLigandId: compound.iupharLigandId ?? null,
      molecularFormula: compound.molecularFormula ?? null,
      canonicalSmiles: compound.canonicalSmiles ?? null,
      inchiKey: compound.inchiKey ?? null,
      sourceIdsJson: encodeStringArrayJson(compound.sourceIds),
      updatedAt,
    });

  const persistTarget = (target: NeuropharmTargetRecord, updatedAt: string) =>
    upsertTarget({
      targetId: target.targetId,
      name: target.name,
      type: target.type,
      family: target.family ?? null,
      organism: target.organism ?? null,
      sourceIdsJson: encodeStringArrayJson(target.sourceIds),
      updatedAt,
    });

  const persistInteraction = (interaction: NeuropharmInteractionRecord) =>
    upsertInteraction({
      interactionId: interaction.interactionId,
      compoundId: interaction.compoundId,
      targetId: interaction.targetId,
      compoundName: interaction.compoundName,
      targetName: interaction.targetName,
      source: interaction.source,
      evidenceGrade: interaction.evidenceGrade,
      action: interaction.action ?? null,
      measurementType: interaction.measurementType ?? null,
      value: interaction.value ?? null,
      relation: interaction.relation ?? null,
      units: interaction.units ?? null,
      assayContext: interaction.assayContext ?? null,
      publicationIdsJson: encodeStringArrayJson(interaction.publicationIds),
      sourceIdsJson: encodeStringArrayJson(interaction.sourceIds),
      fetchedAt: interaction.fetchedAt,
    });

  const persistPublication = (publication: NeuropharmPublicationRecord) =>
    upsertPublication({
      publicationId: publication.publicationId,
      source: publication.source,
      title: publication.title,
      abstract: publication.abstract ?? null,
      journal: publication.journal ?? null,
      year: publication.year ?? null,
      url: publication.url ?? null,
      sourceIdsJson: encodeStringArrayJson(publication.sourceIds),
      fetchedAt: publication.fetchedAt,
    });

  const persistLocalSnapshot = (snapshot: NeuropharmLocalDatabaseSnapshot) =>
    upsertLocalSnapshot({
      source: snapshot.source,
      status: snapshot.status,
      title: snapshot.title,
      url: snapshot.url,
      downloadUrl: snapshot.downloadUrl,
      filePath: snapshot.filePath ?? null,
      fileName: snapshot.fileName,
      version: snapshot.version ?? null,
      downloadedAt: snapshot.downloadedAt ?? null,
      importedAt: snapshot.importedAt ?? null,
      bytes: snapshot.bytes ?? null,
      rowCount: snapshot.rowCount,
      checksumSha256: snapshot.checksumSha256 ?? null,
      error: snapshot.error ?? null,
    });

  const loadLocalSnapshots = (sources: ReadonlyArray<NeuropharmLocalDatabaseSource>) =>
    Effect.gen(function* () {
      const rows = yield* findLocalSnapshots({ sources: [...sources] }).pipe(
        Effect.catch(() => Effect.succeed([] as LocalDatabaseSnapshotRow[])),
      );
      const bySource = new Map(rows.map((row) => [row.source, toLocalSnapshot(row)]));
      return sources.map(
        (source) =>
          bySource.get(source) ??
          buildMissingSnapshot({ baseDirectory: localDatabaseBaseDirectory, source }),
      );
    });

  const allLocalSources = () => LOCAL_DATABASE_MANIFEST.map((entry) => entry.source);

  const loadCompoundData = (queries: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const compoundRows = yield* Effect.forEach(queries, (query) =>
        findCompoundRows({ query: normalizeQuery(query), limit: 4 }),
      ).pipe(Effect.map((groups) => groups.flat()));
      const compounds = [
        ...new Map(compoundRows.map((row) => [row.compoundId, toCompound(row)])).values(),
      ];
      if (compounds.length === 0) {
        return {
          compounds,
          interactions: [] as NeuropharmInteractionRecord[],
          targets: [] as NeuropharmTargetRecord[],
          publications: [] as NeuropharmPublicationRecord[],
        };
      }
      const interactions = yield* findInteractionsByCompoundIds({
        compoundIds: compounds.map((compound) => compound.compoundId),
      }).pipe(Effect.map((rows) => rows.map(toInteraction)));
      const targetIds = [...new Set(interactions.map((interaction) => interaction.targetId))];
      const targets =
        targetIds.length > 0
          ? yield* findTargetsByIds({ targetIds }).pipe(Effect.map((rows) => rows.map(toTarget)))
          : [];
      const publicationIds = [
        ...new Set(interactions.flatMap((interaction) => interaction.publicationIds)),
      ];
      const publications =
        publicationIds.length > 0
          ? yield* findPublicationsByIds({ publicationIds }).pipe(
              Effect.map((rows) => rows.map(toPublication)),
            )
          : [];
      return { compounds, interactions, targets, publications };
    });

  const syncDatabases: NeuropharmServiceShape["syncDatabases"] = (input) =>
    Effect.gen(function* () {
      const fetchedAt = yield* nowIso;
      const compounds = input.compounds?.length ? input.compounds : ["AF710B", "methylphenidate"];
      const sources: NeuropharmDatabaseSource[] = input.sources
        ? [...input.sources]
        : ["pubchem", "chembl", "iuphar", "pubmed"];
      const connectorSources = sources.filter(
        (source): source is Exclude<NeuropharmDatabaseSource, "bindingdb"> =>
          source !== "bindingdb",
      );
      const bundle = yield* Effect.tryPromise({
        try: () =>
          fetchNeuropharmDatabaseBundle({ compounds, sources: connectorSources, fetchedAt }),
        catch: (cause) =>
          new NeuropharmError({
            message: "Failed to fetch neuropharmacology database records.",
            cause,
          }),
      });
      yield* Effect.forEach(bundle.sourceRecords, persistSourceCache, { discard: true });
      yield* Effect.forEach(bundle.compounds, (compound) => persistCompound(compound, fetchedAt), {
        discard: true,
      });
      yield* Effect.forEach(bundle.targets, (target) => persistTarget(target, fetchedAt), {
        discard: true,
      });
      yield* Effect.forEach(bundle.interactions, persistInteraction, { discard: true });
      yield* Effect.forEach(bundle.publications, persistPublication, { discard: true });
      return {
        syncId: stableId("sync", [fetchedAt, ...compounds, ...sources]),
        status: bundle.sourceStatus.some((status) => status.status === "failed")
          ? "failed"
          : "succeeded",
        compounds: [...bundle.compounds],
        targets: [...bundle.targets],
        interactions: [...bundle.interactions],
        publications: [...bundle.publications],
        sourceStatus: [...bundle.sourceStatus],
      } satisfies NeuropharmDatabaseSyncResult;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new NeuropharmError({
            message: "Failed to sync neuropharmacology databases.",
            cause,
          }),
      ),
    );

  const lookupCompound: NeuropharmServiceShape["lookupCompound"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* findCompoundRows({ query: normalizeQuery(input.query), limit: 1 });
      if (!rows[0]) {
        return {
          targets: [],
          interactions: [],
          publications: [],
          sourceStatus: [
            {
              source: "pubchem",
              status: "idle",
              records: 0,
            },
          ],
        } satisfies NeuropharmCompoundLookupResult;
      }
      const compound = toCompound(rows[0]);
      const data = yield* loadCompoundData([compound.preferredName]);
      return {
        compound,
        targets: input.includeInteractions === false ? [] : data.targets,
        interactions: input.includeInteractions === false ? [] : data.interactions,
        publications: input.includePublications === false ? [] : data.publications,
        sourceStatus: [],
      } satisfies NeuropharmCompoundLookupResult;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new NeuropharmError({
            message: "Failed to look up neuropharmacology compound data.",
            cause,
          }),
      ),
    );

  const compareCompounds: NeuropharmServiceShape["compareCompounds"] = (input) =>
    Effect.gen(function* () {
      const generatedAt = yield* nowIso;
      const requested = input.compounds.slice(0, 4);
      if (requested.length < 2) {
        return yield* new NeuropharmError({ message: "Compare at least two compounds." });
      }
      let data = yield* loadCompoundData(requested);
      if (data.compounds.length < requested.length) {
        yield* syncDatabases({
          compounds: requested,
          sources: ["pubchem", "chembl", "iuphar", "pubmed"],
        });
        data = yield* loadCompoundData(requested);
      }
      const interactions =
        input.includeSpeculative === false
          ? data.interactions.filter((interaction) => interaction.evidenceGrade !== "speculative")
          : data.interactions;
      const measuredCount = interactions.filter(
        (interaction) => interaction.evidenceGrade === "measured",
      ).length;
      const inferredCount = interactions.filter(
        (interaction) => interaction.evidenceGrade === "inferred",
      ).length;
      const title = `${requested.join(" vs ")} receptor and transporter comparison`;
      const graphSpecs = dedupeGraphSpecs([
        ...interactionGraphSpecs(title, interactions),
        ...(interactions.length === 0
          ? [graphSpecFor("interaction_risk_heatmap", title, requested.join(" vs "))]
          : []),
      ]);
      return {
        comparisonId: stableId("comparison", [generatedAt, ...requested]),
        title,
        generatedAt,
        compounds: data.compounds,
        targets: data.targets,
        interactions,
        publications: data.publications,
        graphSpecs,
        evidenceSummary: [
          `${measuredCount} measured interaction record(s), ${inferredCount} inferred interaction record(s).`,
          "AF710B relationships should remain evidence-bounded around M1 muscarinic and sigma-1 mechanisms unless direct receptor assay data is imported.",
          "Methylphenidate relationships should prioritize DAT/NET transporter evidence and literature-backed catecholaminergic effects.",
        ],
        safetyNotices: [
          "Research-only comparison; not prescribing, diagnosis, or personal dosing guidance.",
          "Do not convert database affinity/activity values into human dose recommendations.",
        ],
      } satisfies NeuropharmCompoundComparisonResult;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new NeuropharmError({
            message: "Failed to compare neuropharmacology compounds.",
            cause,
          }),
      ),
    );

  const searchLibrary: NeuropharmServiceShape["searchLibrary"] = (input) =>
    findEvidence({ query: normalizeQuery(input.query), limit: input.limit ?? 10 }).pipe(
      Effect.map((rows) => rows.map(toEvidenceRecord)),
      Effect.mapError(
        (cause) =>
          new NeuropharmError({
            message: "Failed to search the local neuropharmacology evidence library.",
            cause,
          }),
      ),
    );

  const persistImportedDocument = (input: NeuropharmImportDocumentInput) =>
    Effect.gen(function* () {
      const importedAt = yield* nowIso;
      const tags = input.tags ?? [];
      const evidence: NeuropharmEvidenceRecord = {
        evidenceId: stableId("evidence", [input.source, input.title, input.content]),
        sourceId: stableId("source", [input.source, input.url ?? input.title]),
        source: input.source,
        title: input.title,
        ...(input.url ? { url: input.url } : {}),
        ...(input.citation ? { citation: input.citation } : {}),
        snippet: input.content.slice(0, 8_000),
        tags,
        importedAt,
      };
      yield* insertEvidence({
        ...evidence,
        url: evidence.url ?? null,
        citation: evidence.citation ?? null,
        tags: encodeTagsJson(evidence.tags),
      });
      return evidence;
    });

  const databaseStatus: NeuropharmServiceShape["databaseStatus"] = () =>
    Effect.gen(function* () {
      const snapshots = yield* loadLocalSnapshots(allLocalSources());
      return {
        baseDirectory: localDatabaseBaseDirectory,
        manifest: [...LOCAL_DATABASE_MANIFEST],
        snapshots,
        totalBytes: snapshots.reduce((total, snapshot) => total + (snapshot.bytes ?? 0), 0),
      } satisfies NeuropharmLocalDatabaseStatusResult;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new NeuropharmError({
            message: "Failed to read local neuropharmacology database status.",
            cause,
          }),
      ),
    );

  const downloadDatabases: NeuropharmServiceShape["downloadDatabases"] = (input) =>
    Effect.gen(function* () {
      const fetchedAt = yield* nowIso;
      const sources = input.sources?.length ? input.sources : allLocalSources();
      const snapshots: NeuropharmLocalDatabaseSnapshot[] = [];
      for (const source of sources) {
        const downloadInput = {
          baseDirectory: localDatabaseBaseDirectory,
          source,
          fetchedAt,
          ...(input.forceRefresh === undefined ? {} : { forceRefresh: input.forceRefresh }),
        };
        const outcome = yield* Effect.tryPromise({
          try: () => downloadLocalDatabase(downloadInput),
          catch: (cause) =>
            new NeuropharmError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        }).pipe(
          Effect.matchEffect({
            onFailure: (cause) => {
              const failed = {
                ...buildMissingSnapshot({ baseDirectory: localDatabaseBaseDirectory, source }),
                status: "failed" as const,
                error: cause.message,
              };
              snapshots.push(failed);
              return persistLocalSnapshot(failed).pipe(Effect.as(null));
            },
            onSuccess: (value) => Effect.succeed(value),
          }),
        );
        if (!outcome) continue;
        yield* persistLocalSnapshot(outcome.snapshot);
        yield* Effect.forEach(
          outcome.compounds,
          (compound) => persistCompound(compound, fetchedAt),
          { discard: true },
        );
        yield* Effect.forEach(outcome.targets, (target) => persistTarget(target, fetchedAt), {
          discard: true,
        });
        yield* Effect.forEach(outcome.interactions, persistInteraction, { discard: true });
        snapshots.push(outcome.snapshot);
      }
      const largeDownloads = LOCAL_DATABASE_MANIFEST.filter(
        (entry) => sources.includes(entry.source) && (entry.estimatedSizeBytes ?? 0) > 500_000_000,
      );
      return {
        downloadId: stableId("local-db-download", [fetchedAt, ...sources]),
        status: snapshots.some((snapshot) => snapshot.status === "failed") ? "failed" : "succeeded",
        baseDirectory: localDatabaseBaseDirectory,
        snapshots,
        warnings: largeDownloads.map(
          (entry) =>
            `${entry.title} is about ${Math.round((entry.estimatedSizeBytes ?? 0) / 1_000_000)} MB and may take time to download.`,
        ),
      } satisfies NeuropharmLocalDatabaseDownloadResult;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new NeuropharmError({
            message: "Failed to download local neuropharmacology databases.",
            cause,
          }),
      ),
    );

  const searchLocal = (input: NeuropharmLocalSearchInput) =>
    Effect.gen(function* () {
      const query = normalizeQuery(input.query);
      const limit = input.limit ?? 25;
      const sources = input.sources?.length ? input.sources : allLocalSources();
      const [compoundRows, interactionRows, targetRows, snapshots] = yield* Effect.all([
        findCompoundRows({ query, limit }),
        findInteractionsByQuery({ query, limit }),
        findTargetsByQuery({ query, limit }),
        loadLocalSnapshots(sources),
      ]);
      const compounds = new Map(compoundRows.map((row) => [row.compoundId, toCompound(row)]));
      const targets = new Map(targetRows.map((row) => [row.targetId, toTarget(row)]));
      const interactions = interactionRows.map(toInteraction);
      for (const interaction of interactions) {
        if (!targets.has(interaction.targetId)) {
          targets.set(interaction.targetId, {
            targetId: interaction.targetId,
            name: interaction.targetName,
            type: "target",
            sourceIds: interaction.sourceIds,
          });
        }
        if (!compounds.has(interaction.compoundId)) {
          compounds.set(interaction.compoundId, {
            compoundId: interaction.compoundId,
            preferredName: interaction.compoundName,
            synonyms: [interaction.compoundName],
            sourceIds: interaction.sourceIds,
          });
        }
      }

      return {
        query,
        compounds: [...compounds.values()].slice(0, limit),
        targets: [...targets.values()].slice(0, limit),
        interactions: interactions.slice(0, limit),
        snapshots,
      } satisfies NeuropharmLocalSearchResult;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new NeuropharmError({
            message: "Failed to search local neuropharmacology databases.",
            cause,
          }),
      ),
    );

  const searchLocalReceptors: NeuropharmServiceShape["searchLocalReceptors"] = searchLocal;
  const searchLocalInteractions: NeuropharmServiceShape["searchLocalInteractions"] = searchLocal;

  return {
    searchSources: (input) =>
      Effect.gen(function* () {
        const fetchedAt = yield* nowIso;
        const query = normalizeQuery(input.query);
        const requestedSources = input.sources ?? ["chembl", "pubchem", "iuphar", "pubmed"];
        return {
          records: requestedSources.map((source) => buildSourceRecord(source, query, fetchedAt)),
        };
      }),
    importDocument: (input) =>
      persistImportedDocument(input).pipe(
        Effect.mapError(
          (cause) =>
            new NeuropharmError({
              message: "Failed to import neuropharmacology document.",
              cause,
            }),
        ),
      ),
    installBasicsPack: () =>
      Effect.gen(function* () {
        const imported = yield* Effect.forEach(
          NEUROPHARM_BASICS_PACK_DOCUMENTS,
          persistImportedDocument,
        );
        return {
          packId: "neuropharm-basics-m1-af710b-cognition-v1",
          imported,
          topics: [...NEUROPHARM_BASICS_PACK_TOPICS],
        } satisfies NeuropharmBasicsPackResult;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new NeuropharmError({
              message: "Failed to install the neuropharmacology basics pack.",
              cause,
            }),
        ),
      ),
    searchLibrary,
    buildEvidencePack: (input) =>
      Effect.gen(function* () {
        const evidence = yield* searchLibrary({ query: input.query, limit: input.limit ?? 8 });
        return {
          estimate: {
            query: input.query,
            summary:
              evidence.length > 0
                ? "Evidence pack assembled from local imported records. Use it to ground receptor, PK/PD, interaction, and dosing-range analysis."
                : "No matching local records were found. Fetch curated sources or import documents before treating estimates as evidence-backed.",
            confidence: evidence.length >= 3 ? "moderate" : "low",
            assumptions: [
              "Estimates are evidence/heuristic summaries, not validated clinical predictions.",
              "Source quality depends on imported documents and curated database records.",
            ],
            riskFlags: [
              "Check serotonergic, dopaminergic, cardiovascular, seizure-threshold, and CYP interaction risks when relevant.",
            ],
            evidence,
          },
        };
      }),
    generateGraphSpec: (input) =>
      Effect.succeed({
        ...graphSpecFor(input.kind, input.title, input.query ?? input.title),
      }),
    analyze: (input) =>
      Effect.gen(function* () {
        const generatedAt = yield* nowIso;
        const query = normalizeQuery(input.query);
        const title = analysisTitle(input);
        yield* Effect.forEach(NEUROPHARM_BASICS_PACK_DOCUMENTS, persistImportedDocument, {
          discard: true,
        });
        const searchQueries = analysisSearchQueries(input);
        const evidenceLimit = input.limit ?? 8;
        const evidence = yield* Effect.forEach(searchQueries, (searchQuery) =>
          searchLibrary({ query: searchQuery, limit: evidenceLimit }),
        ).pipe(Effect.map((groups) => uniqueEvidence(groups.flat()).slice(0, evidenceLimit)));
        const compoundSeeds = compoundSeedsForAnalysis(input);
        if (compoundSeeds.length > 0) {
          yield* syncDatabases({ compounds: compoundSeeds, sources: [] });
        }
        const localSearches = yield* Effect.forEach(searchQueries, (searchQuery) =>
          searchLocal({ query: searchQuery, limit: 20 }),
        );
        const localInteractions = uniqueInteractions(
          localSearches.flatMap((localSearch) => localSearch.interactions),
        );
        const compoundData =
          compoundSeeds.length > 0
            ? yield* loadCompoundData(compoundSeeds)
            : {
                compounds: [],
                interactions: [] as NeuropharmInteractionRecord[],
                targets: [] as NeuropharmTargetRecord[],
                publications: [] as NeuropharmPublicationRecord[],
              };
        const databaseInteractions = uniqueInteractions([
          ...localInteractions,
          ...compoundData.interactions,
        ]);
        const snapshots = yield* loadLocalSnapshots(allLocalSources());
        const importedSnapshots = snapshots.filter((snapshot) => snapshot.status === "imported");
        const confidence =
          evidence.length >= 5 ||
          databaseInteractions.some((entry) => entry.evidenceGrade === "measured")
            ? "moderate"
            : "low";
        const graphSpecs = dedupeGraphSpecs([
          ...interactionGraphSpecs(title, databaseInteractions),
          ...graphKindsForMode(input.mode).map((kind) => graphSpecFor(kind, title, query)),
        ]);
        const graphNodes = [
          ...new Map(
            [...buildGraphNodes(input), ...graphNodesForInteractions(databaseInteractions)].map(
              (entry) => [entry.nodeId, entry],
            ),
          ).values(),
        ];
        const graphEdges = [
          ...buildGraphEdges(graphNodes, evidence),
          ...buildDatabaseGraphEdges(graphNodes, databaseInteractions),
        ];
        const result = {
          analysisId: stableId("analysis", [input.mode, query, generatedAt]),
          mode: input.mode,
          title,
          generatedAt,
          estimate: {
            query,
            summary:
              evidence.length > 0 || databaseInteractions.length > 0
                ? `${title} assembled from ${evidence.length} local evidence note(s) and ${databaseInteractions.length} database interaction row(s), with local receptor/database records prioritized before model extrapolation.`
                : `${title} generated as a research scaffold after checking the local library and receptor database. Import PubMed, ChEMBL, IUPHAR, PubChem, PDF, URL, CSV, or note evidence before treating estimates as source-backed.`,
            confidence,
            assumptions: [
              "The built-in basics pack is installed automatically and treated as primer context rather than primary evidence.",
              `Local database status: ${importedSnapshots.length}/${snapshots.length} snapshot(s) imported; ${databaseInteractions.length} relevant interaction row(s) attached to graph artifacts.`,
              "Mechanistic extrapolation is allowed only when explicitly labeled as low-confidence.",
              "Human, animal, in-vitro, in-silico, and anecdotal evidence should remain separated in final prose.",
              "Research protocol ranges are not personalized medical instructions.",
            ],
            riskFlags: [
              "Screen serotonergic, dopaminergic, glutamatergic, cardiovascular, seizure-threshold, hepatic, renal, CYP, and transporter risks as relevant.",
              "Flag contraindication-like concerns as research safety notices unless directly supported by imported sources.",
            ],
            evidence,
          },
          graphSpecs,
          graphNodes,
          graphEdges,
          diagrams:
            (input.includeDiagrams ?? true)
              ? [
                  {
                    title: `${title} mechanism diagram`,
                    format: "mermaid",
                    content: buildMermaid(input),
                    notes: ["Diagram edges are hypotheses until linked to cited evidence."],
                  },
                ]
              : [],
          ...((input.includeLatex ?? true) ? { latex: latexForAnalysis(input, evidence) } : {}),
          powerUserNotes: [
            "Advanced mode exposes heuristic assumptions, graph JSON, raw evidence, and low-confidence extrapolations.",
            `Database-backed graph generation used ${databaseInteractions.length} interaction row(s), ${compoundData.compounds.length} compound identity row(s), and ${compoundData.targets.length} target row(s).`,
            "Use target_network, receptor_selectivity_radar, interaction_risk_heatmap, and task_domain_matrix specs as the primary inspectable claim map; weak cells should trigger source import or manual review.",
          ],
          safetyNotices: [
            "Research-only analysis; not diagnosis, treatment, prescribing, or emergency guidance.",
            "Do not convert dose/range evidence into personalized use instructions.",
          ],
        } satisfies NeuropharmAnalysisResult;
        yield* insertAnalysisRun({
          analysisId: result.analysisId,
          mode: result.mode,
          title: result.title,
          query,
          generatedAt,
          resultJson: encodeAnalysisResultJson(result),
        }).pipe(
          Effect.mapError(
            (cause) =>
              new NeuropharmError({
                message: "Failed to persist neuropharmacology analysis run.",
                cause,
              }),
          ),
        );
        return result;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new NeuropharmError({
              message: "Failed to analyze neuropharmacology request.",
              cause,
            }),
        ),
      ),
    syncDatabases,
    lookupCompound,
    compareCompounds,
    downloadDatabases,
    databaseStatus,
    searchLocalReceptors,
    searchLocalInteractions,
  } satisfies NeuropharmServiceShape;
});

export const NeuropharmServiceLive = Layer.effect(NeuropharmService, makeService);
