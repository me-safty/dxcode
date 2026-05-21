import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { NeuropharmService, NeuropharmServiceLive } from "./NeuropharmService.ts";

const layer = NeuropharmServiceLive.pipe(
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "neuropharm-service-test-" })),
  Layer.provide(NodeServices.layer),
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NeuropharmService", () => {
  it("imports and searches local evidence", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        yield* service.importDocument({
          title: "Modafinil dopamine transporter evidence",
          source: "user_note",
          content: "DAT occupancy and wakefulness evidence.",
          tags: ["modafinil", "DAT"],
        });
        return yield* service.searchLibrary({ query: "DAT", limit: 5 });
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toContain("Modafinil");
  });

  it("installs M1, AF710B, and cognition basics into the evidence library", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        const pack = yield* service.installBasicsPack({ forceRefresh: false });
        const af710b = yield* service.searchLibrary({ query: "AF710B", limit: 5 });
        const m1 = yield* service.searchLibrary({ query: "CHRM1", limit: 5 });
        const cognition = yield* service.searchLibrary({ query: "niche targets", limit: 5 });
        return { pack, af710b, m1, cognition };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.pack.packId).toContain("neuropharm-basics");
    expect(result.pack.imported.length).toBeGreaterThanOrEqual(8);
    expect(result.af710b.some((record) => record.title.includes("AF710B"))).toBe(true);
    expect(result.m1.some((record) => record.tags.includes("CHRM1"))).toBe(true);
    expect(result.cognition.some((record) => record.tags.includes("niche targets"))).toBe(true);
  });

  it("returns missing local database snapshots when an older database lacks snapshot tables", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        return yield* service.databaseStatus({});
      }).pipe(Effect.provide(layer)),
    );

    expect(result.snapshots.map((snapshot) => snapshot.status)).toEqual([
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
      "not_downloaded",
    ]);
  });

  it("builds curated source search records", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        return yield* service.searchSources({
          query: "ketamine NMDA",
          sources: ["chembl", "pubmed"],
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.records.map((record) => record.source)).toEqual(["chembl", "pubmed"]);
    expect(result.records[0]?.url).toContain("ebi.ac.uk");
  });

  it("builds structured compound analysis artifacts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        yield* service.importDocument({
          title: "Modafinil DAT and wakefulness evidence",
          source: "pubmed",
          content:
            "Human and imaging evidence discussing wakefulness and dopamine transporter activity.",
          tags: ["modafinil", "DAT", "wakefulness"],
        });
        return yield* service.analyze({
          mode: "compound_profile",
          query: "modafinil",
          compounds: ["modafinil"],
          targets: ["DAT", "orexin"],
          includeLatex: true,
          includeDiagrams: true,
          powerUser: true,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.mode).toBe("compound_profile");
    expect(result.graphSpecs.length).toBeGreaterThan(1);
    expect(result.graphNodes.some((node) => node.kind === "compound")).toBe(true);
    expect(result.diagrams[0]?.format).toBe("mermaid");
    expect(result.latex?.latex).toContain("\\section");
    expect(result.estimate.evidence.some((record) => record.title.includes("Modafinil"))).toBe(
      true,
    );
    expect(result.estimate.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-grounds AF710B analysis in basics notes and cached receptor database graph specs", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        return yield* service.analyze({
          mode: "compound_profile",
          query: "AF710B cognition M1 sigma-1",
          compounds: ["AF710B"],
          targets: ["CHRM1", "SIGMAR1"],
          includeLatex: true,
          includeDiagrams: true,
          powerUser: true,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.estimate.evidence.some((record) => record.tags.includes("basics-pack"))).toBe(
      true,
    );
    expect(result.graphSpecs.some((spec) => spec.kind === "target_network")).toBe(true);
    expect(result.graphSpecs.some((spec) => spec.kind === "receptor_selectivity_radar")).toBe(true);
    expect(result.graphSpecs.some((spec) => spec.kind === "interaction_risk_heatmap")).toBe(true);
    expect(
      result.graphSpecs.some((spec) =>
        spec.data.some((datum) => `${datum.label} ${datum.group ?? ""}`.includes("AF710B")),
      ),
    ).toBe(true);
    expect(result.powerUserNotes.join(" ")).toContain("Database-backed graph generation");
  });

  it("syncs curated AF710B and methylphenidate receptor database records", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        return yield* service.syncDatabases({
          compounds: ["AF710B", "methylphenidate"],
          sources: [],
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.compounds.map((compound) => compound.preferredName)).toContain("AF710B");
    expect(result.compounds.map((compound) => compound.preferredName)).toContain("methylphenidate");
    expect(result.interactions.some((interaction) => interaction.targetName.includes("DAT"))).toBe(
      true,
    );
    expect(result.interactions.every((interaction) => interaction.evidenceGrade)).toBe(true);
  });

  it("compares AF710B and methylphenidate from cached receptor database records", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        yield* service.syncDatabases({
          compounds: ["AF710B", "methylphenidate"],
          sources: [],
        });
        return yield* service.compareCompounds({
          compounds: ["AF710B", "methylphenidate"],
          includeSpeculative: false,
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.title).toContain("AF710B");
    expect(result.interactions.some((interaction) => interaction.targetName.includes("M1"))).toBe(
      true,
    );
    expect(result.interactions.some((interaction) => interaction.targetName.includes("NET"))).toBe(
      true,
    );
    expect(result.graphSpecs.some((spec) => spec.kind === "target_network")).toBe(true);
    expect(result.graphSpecs.some((spec) => spec.kind === "receptor_selectivity_radar")).toBe(true);
    expect(result.graphSpecs.some((spec) => spec.kind === "interaction_risk_heatmap")).toBe(true);
    expect(result.graphSpecs.some((spec) => spec.kind === "task_domain_matrix")).toBe(true);
  });

  it("downloads and searches a local IUPHAR receptor snapshot", async () => {
    const iupharTsv = [
      '"# GtoPdb Version: 2026.1 - published: 2026-03-12"',
      [
        '"Target"',
        '"Target ID"',
        '"Target Gene Symbol"',
        '"Target Species"',
        '"Ligand ID"',
        '"Ligand"',
        '"Type"',
        '"Action"',
        '"Affinity Median"',
        '"Original Affinity Units"',
        '"Original Affinity Median nm"',
        '"Original Affinity Relation"',
        '"Assay Description"',
        '"PubMed ID"',
      ].join("\t"),
      [
        '"M1 muscarinic acetylcholine receptor"',
        '"101"',
        '"CHRM1"',
        '"Human"',
        '"9001"',
        '"AF710B"',
        '"Agonist"',
        '"positive allosteric modulation"',
        '"7.1"',
        '"Ki"',
        '"42"',
        '"="',
        '"local receptor assay row"',
        '"12345678"',
      ].join("\t"),
    ].join("\n");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(iupharTsv, {
        status: 200,
        headers: { "content-type": "text/tab-separated-values" },
      }),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        const download = yield* service.downloadDatabases({
          sources: ["iuphar"],
          importAfterDownload: true,
        });
        const localRows = yield* service.searchLocalInteractions({
          query: "AF710B",
          sources: ["iuphar"],
          limit: 10,
        });
        return { download, localRows };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.download.snapshots[0]?.status).toBe("imported");
    expect(result.localRows.interactions[0]?.targetName).toContain("M1 muscarinic");
    expect(result.localRows.interactions[0]?.value).toBe(42);
  });

  it("keeps the default local database manifest under one and a half gigabytes", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* NeuropharmService;
        return yield* service.databaseStatus({});
      }).pipe(Effect.provide(layer)),
    );

    const estimatedBytes = result.manifest.reduce(
      (total, entry) => total + (entry.estimatedSizeBytes ?? 0),
      0,
    );
    expect(result.manifest.map((entry) => entry.source)).toEqual([
      "iuphar",
      "iuphar_ligands",
      "iuphar_targets",
      "iuphar_physchem",
      "bindingdb",
      "bindingdb_chembl",
      "bindingdb_patents",
      "bindingdb_pubchem",
      "bindingdb_articles",
      "bindingdb_assays",
      "bindingdb_pdsp",
      "bindingdb_rsid",
    ]);
    expect(estimatedBytes).toBeLessThan(1_500_000_000);
  });
});
