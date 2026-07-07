import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  NeuropharmAnalysisInput,
  NeuropharmAnalysisResult,
  NeuropharmCompoundComparisonInput,
  NeuropharmCompoundComparisonResult,
  NeuropharmDatabaseSyncInput,
  NeuropharmLocalDatabaseDownloadInput,
  NeuropharmLocalDatabaseStatusResult,
  NeuropharmLocalSearchInput,
  NeuropharmBasicsPackInput,
  NeuropharmBasicsPackResult,
  NeuropharmGenerateGraphSpecInput,
  NeuropharmImportDocumentInput,
  NeuropharmSearchSourcesInput,
} from "./neuropharm.ts";

const decodeSearchSourcesInput = Schema.decodeUnknownSync(NeuropharmSearchSourcesInput);
const decodeImportDocumentInput = Schema.decodeUnknownSync(NeuropharmImportDocumentInput);
const decodeGenerateGraphSpecInput = Schema.decodeUnknownSync(NeuropharmGenerateGraphSpecInput);
const decodeAnalysisInput = Schema.decodeUnknownSync(NeuropharmAnalysisInput);
const decodeAnalysisResult = Schema.decodeUnknownSync(NeuropharmAnalysisResult);
const decodeDatabaseSyncInput = Schema.decodeUnknownSync(NeuropharmDatabaseSyncInput);
const decodeLocalDatabaseDownloadInput = Schema.decodeUnknownSync(
  NeuropharmLocalDatabaseDownloadInput,
);
const decodeLocalDatabaseStatusResult = Schema.decodeUnknownSync(
  NeuropharmLocalDatabaseStatusResult,
);
const decodeLocalSearchInput = Schema.decodeUnknownSync(NeuropharmLocalSearchInput);
const decodeBasicsPackInput = Schema.decodeUnknownSync(NeuropharmBasicsPackInput);
const decodeBasicsPackResult = Schema.decodeUnknownSync(NeuropharmBasicsPackResult);
const decodeCompoundComparisonInput = Schema.decodeUnknownSync(NeuropharmCompoundComparisonInput);
const decodeCompoundComparisonResult = Schema.decodeUnknownSync(NeuropharmCompoundComparisonResult);

describe("neuropharm contracts", () => {
  it("decodes source search requests", () => {
    const parsed = decodeSearchSourcesInput({
      query: "  psilocybin 5-HT2A  ",
      domains: ["receptors"],
      sources: ["chembl", "pubmed"],
    });

    expect(parsed.query).toBe("psilocybin 5-HT2A");
    expect(parsed.sources).toEqual(["chembl", "pubmed"]);
  });

  it("decodes document imports", () => {
    const parsed = decodeImportDocumentInput({
      title: "A receptor paper",
      source: "user_note",
      content: "Evidence text",
      tags: ["5-HT2A"],
    });

    expect(parsed.title).toBe("A receptor paper");
    expect(parsed.tags).toEqual(["5-HT2A"]);
  });

  it("decodes basics pack install results", () => {
    expect(decodeBasicsPackInput({ forceRefresh: false }).forceRefresh).toBe(false);

    const parsed = decodeBasicsPackResult({
      packId: "neuropharm-basics-m1-af710b-cognition-v1",
      topics: ["M1 receptor basics", "AF710B / ANAVEX 3-71"],
      imported: [
        {
          evidenceId: "evidence-1",
          sourceId: "source-1",
          source: "url",
          title: "AF710B primer",
          url: "https://pubmed.ncbi.nlm.nih.gov/?term=AF710B",
          snippet: "AF710B and ANAVEX 3-71 local primer.",
          tags: ["AF710B", "basics-pack"],
          importedAt: "2026-05-21T00:00:00.000Z",
        },
      ],
    });

    expect(parsed.imported[0]?.tags).toContain("basics-pack");
  });

  it("rejects unknown graph kinds", () => {
    expect(() =>
      decodeGenerateGraphSpecInput({
        kind: "unknown",
        title: "Graph",
      }),
    ).toThrow();
  });

  it("decodes power-user analysis requests", () => {
    const parsed = decodeAnalysisInput({
      mode: "stack_checker",
      query: "modafinil plus caffeine",
      compounds: ["modafinil", "caffeine"],
      includeLatex: true,
      includeDiagrams: true,
      powerUser: true,
    });

    expect(parsed.mode).toBe("stack_checker");
    expect(parsed.powerUser).toBe(true);
  });

  it("decodes structured analysis results", () => {
    const parsed = decodeAnalysisResult({
      analysisId: "analysis-test",
      mode: "compound_profile",
      title: "compound profile: modafinil",
      generatedAt: "2026-05-21T00:00:00.000Z",
      estimate: {
        query: "modafinil",
        summary: "Evidence-backed scaffold.",
        confidence: "low",
        assumptions: ["research only"],
        riskFlags: ["CYP review"],
        evidence: [],
      },
      graphSpecs: [],
      graphNodes: [],
      graphEdges: [],
      diagrams: [],
      powerUserNotes: ["raw evidence exposed"],
      safetyNotices: ["not medical advice"],
    });

    expect(parsed.analysisId).toBe("analysis-test");
  });

  it("decodes database sync requests", () => {
    const parsed = decodeDatabaseSyncInput({
      compounds: ["AF710B", "methylphenidate"],
      sources: ["pubchem", "chembl", "iuphar", "pubmed"],
    });

    expect(parsed.compounds).toEqual(["AF710B", "methylphenidate"]);
    expect(parsed.sources).toContain("iuphar");
  });

  it("decodes local database download requests", () => {
    const parsed = decodeLocalDatabaseDownloadInput({
      sources: ["iuphar", "bindingdb", "bindingdb_chembl", "bindingdb_pdsp"],
      importAfterDownload: true,
    });

    expect(parsed.sources).toEqual(["iuphar", "bindingdb", "bindingdb_chembl", "bindingdb_pdsp"]);
    expect(parsed.importAfterDownload).toBe(true);
  });

  it("decodes local database status results", () => {
    const parsed = decodeLocalDatabaseStatusResult({
      baseDirectory: "/tmp/neuropharm/databases",
      manifest: [
        {
          source: "iuphar",
          title: "IUPHAR",
          description: "receptor rows",
          url: "https://www.guidetopharmacology.org/download.jsp",
          downloadUrl: "https://www.guidetopharmacology.org/DATA/interactions.tsv",
          fileName: "iuphar_interactions.tsv",
          importMode: "tsv",
          priority: 1,
        },
      ],
      snapshots: [
        {
          source: "iuphar",
          status: "imported",
          title: "IUPHAR",
          url: "https://www.guidetopharmacology.org/download.jsp",
          downloadUrl: "https://www.guidetopharmacology.org/DATA/interactions.tsv",
          fileName: "iuphar_interactions.tsv",
          rowCount: 1,
        },
      ],
      totalBytes: 128,
    });

    expect(parsed.snapshots[0]?.status).toBe("imported");
  });

  it("decodes local receptor search requests", () => {
    const parsed = decodeLocalSearchInput({
      query: "CHRM1 methylphenidate",
      sources: ["iuphar", "iuphar_targets", "bindingdb"],
      limit: 10,
    });

    expect(parsed.sources).toEqual(["iuphar", "iuphar_targets", "bindingdb"]);
  });

  it("decodes compound comparison requests", () => {
    const parsed = decodeCompoundComparisonInput({
      compounds: ["AF710B", "methylphenidate"],
      includeSpeculative: false,
    });

    expect(parsed.compounds).toEqual(["AF710B", "methylphenidate"]);
  });

  it("decodes compound comparison results with evidence grades", () => {
    const parsed = decodeCompoundComparisonResult({
      comparisonId: "comparison-test",
      title: "AF710B vs methylphenidate",
      generatedAt: "2026-05-21T00:00:00.000Z",
      compounds: [],
      targets: [],
      interactions: [
        {
          interactionId: "interaction-test",
          compoundId: "compound-af710b",
          targetId: "target-chrm1",
          compoundName: "AF710B",
          targetName: "M1 muscarinic acetylcholine receptor",
          source: "pubmed",
          evidenceGrade: "inferred",
          publicationIds: [],
          sourceIds: ["source-test"],
          fetchedAt: "2026-05-21T00:00:00.000Z",
        },
      ],
      publications: [],
      graphSpecs: [],
      evidenceSummary: ["1 inferred record"],
      safetyNotices: ["research only"],
    });

    expect(parsed.interactions[0]?.evidenceGrade).toBe("inferred");
  });
});
