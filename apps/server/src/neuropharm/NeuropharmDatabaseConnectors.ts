import type {
  NeuropharmCompoundIdentity,
  NeuropharmDatabaseSource,
  NeuropharmDatabaseSourceStatus,
  NeuropharmInteractionRecord,
  NeuropharmPublicationRecord,
  NeuropharmTargetRecord,
} from "@t3tools/contracts";

export interface NeuropharmCachedSourceRecord {
  readonly sourceRecordId: string;
  readonly source: NeuropharmDatabaseSource;
  readonly externalId: string;
  readonly url?: string;
  readonly title: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
}

export interface NeuropharmConnectorBundle {
  readonly compounds: ReadonlyArray<NeuropharmCompoundIdentity>;
  readonly targets: ReadonlyArray<NeuropharmTargetRecord>;
  readonly interactions: ReadonlyArray<NeuropharmInteractionRecord>;
  readonly publications: ReadonlyArray<NeuropharmPublicationRecord>;
  readonly sourceRecords: ReadonlyArray<NeuropharmCachedSourceRecord>;
  readonly sourceStatus: ReadonlyArray<NeuropharmDatabaseSourceStatus>;
}

const DEFAULT_COMPOUNDS = ["AF710B", "methylphenidate"] as const;

function stableId(prefix: string, parts: ReadonlyArray<string>): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function lower(value: string): string {
  return normalize(value).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : undefined;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await globalThis.fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.json();
}

function sourceStatus(
  source: NeuropharmDatabaseSource,
  status: NeuropharmDatabaseSourceStatus["status"],
  records: number,
  fetchedAt: string,
  error?: unknown,
): NeuropharmDatabaseSourceStatus {
  return {
    source,
    status,
    records,
    fetchedAt,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  };
}

function cacheRecord(input: {
  readonly source: NeuropharmDatabaseSource;
  readonly externalId: string;
  readonly title: string;
  readonly url?: string;
  readonly payload: unknown;
  readonly fetchedAt: string;
}): NeuropharmCachedSourceRecord {
  return {
    sourceRecordId: stableId("source-record", [input.source, input.externalId]),
    source: input.source,
    externalId: input.externalId,
    title: input.title,
    ...(input.url ? { url: input.url } : {}),
    payload: input.payload,
    fetchedAt: input.fetchedAt,
  };
}

function compoundId(name: string): string {
  return stableId("compound", [lower(name)]);
}

function target(id: string, name: string, type: string, family: string): NeuropharmTargetRecord {
  return {
    targetId: id,
    name,
    type,
    family,
    organism: "Homo sapiens",
    sourceIds: [stableId("seed-source", [id])],
  };
}

const seedTargets = {
  chrm1: target(
    "target-chrm1",
    "M1 muscarinic acetylcholine receptor (CHRM1)",
    "receptor",
    "Muscarinic acetylcholine receptors",
  ),
  sigmar1: target("target-sigmar1", "Sigma-1 receptor (SIGMAR1)", "receptor", "Sigma receptors"),
  dat: target(
    "target-slc6a3",
    "Dopamine transporter (DAT/SLC6A3)",
    "transporter",
    "Solute carrier neurotransmitter transporters",
  ),
  net: target(
    "target-slc6a2",
    "Norepinephrine transporter (NET/SLC6A2)",
    "transporter",
    "Solute carrier neurotransmitter transporters",
  ),
};

function seedCompound(name: string): NeuropharmCompoundIdentity {
  const key = lower(name);
  if (key.includes("methylphenidate")) {
    return {
      compoundId: compoundId("methylphenidate"),
      preferredName: "methylphenidate",
      synonyms: ["methylphenidate", "Ritalin", "MPH"],
      pubchemCid: "4158",
      chemblId: "CHEMBL796",
      sourceIds: [stableId("seed-source", ["methylphenidate"])],
    };
  }
  return {
    compoundId: compoundId("AF710B"),
    preferredName: "AF710B",
    synonyms: ["AF710B", "ANAVEX3-71", "AF-710B"],
    sourceIds: [stableId("seed-source", ["af710b"])],
  };
}

function seedInteractions(name: string, fetchedAt: string): NeuropharmInteractionRecord[] {
  const compound = seedCompound(name);
  const key = lower(compound.preferredName);
  if (key.includes("methylphenidate")) {
    return [
      {
        interactionId: stableId("interaction", [
          compound.compoundId,
          seedTargets.dat.targetId,
          "seed",
        ]),
        compoundId: compound.compoundId,
        targetId: seedTargets.dat.targetId,
        compoundName: compound.preferredName,
        targetName: seedTargets.dat.name,
        source: "chembl",
        evidenceGrade: "inferred",
        action: "dopamine transporter inhibition",
        measurementType: "transporter pharmacology",
        assayContext:
          "Seeded target relationship; replace with measured ChEMBL/IUPHAR values when available.",
        publicationIds: [],
        sourceIds: compound.sourceIds,
        fetchedAt,
      },
      {
        interactionId: stableId("interaction", [
          compound.compoundId,
          seedTargets.net.targetId,
          "seed",
        ]),
        compoundId: compound.compoundId,
        targetId: seedTargets.net.targetId,
        compoundName: compound.preferredName,
        targetName: seedTargets.net.name,
        source: "chembl",
        evidenceGrade: "inferred",
        action: "norepinephrine transporter inhibition",
        measurementType: "transporter pharmacology",
        assayContext:
          "Seeded target relationship; replace with measured ChEMBL/IUPHAR values when available.",
        publicationIds: [],
        sourceIds: compound.sourceIds,
        fetchedAt,
      },
    ];
  }
  return [
    {
      interactionId: stableId("interaction", [
        compound.compoundId,
        seedTargets.chrm1.targetId,
        "seed",
      ]),
      compoundId: compound.compoundId,
      targetId: seedTargets.chrm1.targetId,
      compoundName: compound.preferredName,
      targetName: seedTargets.chrm1.name,
      source: "pubmed",
      evidenceGrade: "inferred",
      action: "reported M1 muscarinic modulation in preclinical cognition literature",
      measurementType: "mechanistic literature",
      assayContext:
        "Seeded AF710B relationship; keep as inferred unless source import provides direct measured values.",
      publicationIds: [],
      sourceIds: compound.sourceIds,
      fetchedAt,
    },
    {
      interactionId: stableId("interaction", [
        compound.compoundId,
        seedTargets.sigmar1.targetId,
        "seed",
      ]),
      compoundId: compound.compoundId,
      targetId: seedTargets.sigmar1.targetId,
      compoundName: compound.preferredName,
      targetName: seedTargets.sigmar1.name,
      source: "pubmed",
      evidenceGrade: "inferred",
      action: "reported sigma-1 receptor modulation in preclinical cognition literature",
      measurementType: "mechanistic literature",
      assayContext:
        "Seeded AF710B relationship; keep as inferred unless source import provides direct measured values.",
      publicationIds: [],
      sourceIds: compound.sourceIds,
      fetchedAt,
    },
  ];
}

export function buildCuratedSeedBundle(
  compounds: ReadonlyArray<string>,
  fetchedAt: string,
): NeuropharmConnectorBundle {
  const requested = compounds.length > 0 ? compounds : DEFAULT_COMPOUNDS;
  const seededCompounds = requested.map(seedCompound);
  const interactions = requested.flatMap((compound) => seedInteractions(compound, fetchedAt));
  const targetIds = new Set(interactions.map((interaction) => interaction.targetId));
  const targets = Object.values(seedTargets).filter((candidate) =>
    targetIds.has(candidate.targetId),
  );
  return {
    compounds: seededCompounds,
    targets,
    interactions,
    publications: [],
    sourceRecords: seededCompounds.map((compound) =>
      cacheRecord({
        source: compound.preferredName === "methylphenidate" ? "chembl" : "pubmed",
        externalId: compound.compoundId,
        title: `Curated seed profile: ${compound.preferredName}`,
        payload: compound,
        fetchedAt,
      }),
    ),
    sourceStatus: [
      sourceStatus("pubchem", "idle", 0, fetchedAt),
      sourceStatus("chembl", "idle", 0, fetchedAt),
      sourceStatus("iuphar", "idle", 0, fetchedAt),
      sourceStatus("pubmed", "idle", 0, fetchedAt),
    ],
  };
}

async function fetchPubChem(name: string, fetchedAt: string): Promise<NeuropharmConnectorBundle> {
  const encodedName = encodeURIComponent(name);
  const propertyUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodedName}/property/MolecularFormula,CanonicalSMILES,InChIKey,Title/JSON`;
  const payload = await fetchJson(propertyUrl);
  const propertyTable = isRecord(payload) ? payload.PropertyTable : undefined;
  const properties = isRecord(propertyTable) ? firstRecord(propertyTable.Properties) : undefined;
  const cid = properties ? numberValue(properties.CID)?.toString() : undefined;
  const preferredName = stringValue(properties?.Title) ?? normalize(name);
  const compound: NeuropharmCompoundIdentity = {
    compoundId: compoundId(preferredName),
    preferredName,
    synonyms: [preferredName, normalize(name)].filter(
      (value, index, all) => all.indexOf(value) === index,
    ),
    ...(cid ? { pubchemCid: cid } : {}),
    ...(stringValue(properties?.MolecularFormula)
      ? { molecularFormula: stringValue(properties?.MolecularFormula) }
      : {}),
    ...(stringValue(properties?.CanonicalSMILES)
      ? { canonicalSmiles: stringValue(properties?.CanonicalSMILES) }
      : {}),
    ...(stringValue(properties?.InChIKey) ? { inchiKey: stringValue(properties?.InChIKey) } : {}),
    sourceIds: [stableId("source-record", ["pubchem", cid ?? preferredName])],
  };
  return {
    compounds: [compound],
    targets: [],
    interactions: [],
    publications: [],
    sourceRecords: [
      cacheRecord({
        source: "pubchem",
        externalId: cid ?? preferredName,
        title: `PubChem compound properties: ${preferredName}`,
        url: cid ? `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` : propertyUrl,
        payload,
        fetchedAt,
      }),
    ],
    sourceStatus: [sourceStatus("pubchem", "succeeded", 1, fetchedAt)],
  };
}

async function fetchIuphar(name: string, fetchedAt: string): Promise<NeuropharmConnectorBundle> {
  const url = `https://www.guidetopharmacology.org/services/ligands?name=${encodeURIComponent(name)}`;
  const payload = await fetchJson(url);
  const rows = Array.isArray(payload) ? payload.filter(isRecord).slice(0, 5) : [];
  const compounds = rows.map((row) => {
    const ligandId = numberValue(row.ligandId)?.toString() ?? stringValue(row.ligandId);
    const preferredName = stringValue(row.name) ?? normalize(name);
    return {
      compoundId: compoundId(preferredName),
      preferredName,
      synonyms: [preferredName, normalize(name)].filter(
        (value, index, all) => all.indexOf(value) === index,
      ),
      ...(ligandId ? { iupharLigandId: ligandId } : {}),
      sourceIds: [stableId("source-record", ["iuphar", ligandId ?? preferredName])],
    } satisfies NeuropharmCompoundIdentity;
  });
  return {
    compounds,
    targets: [],
    interactions: [],
    publications: [],
    sourceRecords: [
      cacheRecord({
        source: "iuphar",
        externalId: normalize(name),
        title: `IUPHAR/GtoPdb ligand search: ${normalize(name)}`,
        url,
        payload,
        fetchedAt,
      }),
    ],
    sourceStatus: [sourceStatus("iuphar", "succeeded", rows.length, fetchedAt)],
  };
}

async function fetchChembl(name: string, fetchedAt: string): Promise<NeuropharmConnectorBundle> {
  const searchUrl = `https://www.ebi.ac.uk/chembl/api/data/molecule/search.json?q=${encodeURIComponent(name)}`;
  const searchPayload = await fetchJson(searchUrl);
  const molecules = isRecord(searchPayload)
    ? Array.isArray(searchPayload.molecules)
      ? searchPayload.molecules.filter(isRecord)
      : []
    : [];
  const first = molecules[0];
  const chemblId = stringValue(first?.molecule_chembl_id);
  const preferredName = stringValue(first?.pref_name) ?? normalize(name);
  const compound: NeuropharmCompoundIdentity = {
    compoundId: compoundId(preferredName),
    preferredName,
    synonyms: [preferredName, normalize(name)].filter(
      (value, index, all) => all.indexOf(value) === index,
    ),
    ...(chemblId ? { chemblId } : {}),
    sourceIds: [stableId("source-record", ["chembl", chemblId ?? preferredName])],
  };

  if (!chemblId) {
    return {
      compounds: molecules.length ? [compound] : [],
      targets: [],
      interactions: [],
      publications: [],
      sourceRecords: [
        cacheRecord({
          source: "chembl",
          externalId: preferredName,
          title: `ChEMBL molecule search: ${preferredName}`,
          url: searchUrl,
          payload: searchPayload,
          fetchedAt,
        }),
      ],
      sourceStatus: [sourceStatus("chembl", "succeeded", molecules.length, fetchedAt)],
    };
  }

  const activityUrl = `https://www.ebi.ac.uk/chembl/api/data/activity.json?molecule_chembl_id=${encodeURIComponent(chemblId)}&limit=20`;
  const activityPayload = await fetchJson(activityUrl);
  const activities = isRecord(activityPayload)
    ? Array.isArray(activityPayload.activities)
      ? activityPayload.activities.filter(isRecord)
      : []
    : [];
  const targetMap = new Map<string, NeuropharmTargetRecord>();
  const interactions: NeuropharmInteractionRecord[] = [];
  for (const activity of activities) {
    const targetChemblId = stringValue(activity.target_chembl_id);
    const targetName = stringValue(activity.target_pref_name);
    if (!targetChemblId || !targetName) continue;
    const targetRecord: NeuropharmTargetRecord = {
      targetId: stableId("target", ["chembl", targetChemblId]),
      name: targetName,
      type: "target",
      organism: stringValue(activity.target_organism),
      sourceIds: [stableId("source-record", ["chembl", targetChemblId])],
    };
    targetMap.set(targetRecord.targetId, targetRecord);
    const publicationId = stringValue(activity.document_chembl_id);
    interactions.push({
      interactionId: stableId("interaction", [
        compound.compoundId,
        targetRecord.targetId,
        stringValue(activity.activity_id) ?? targetName,
      ]),
      compoundId: compound.compoundId,
      targetId: targetRecord.targetId,
      compoundName: compound.preferredName,
      targetName: targetRecord.name,
      source: "chembl",
      evidenceGrade: "measured",
      action: stringValue(activity.standard_type),
      measurementType: stringValue(activity.standard_type),
      value: numberValue(activity.standard_value),
      relation: stringValue(activity.standard_relation),
      units: stringValue(activity.standard_units),
      assayContext: stringValue(activity.assay_description),
      publicationIds: publicationId ? [publicationId] : [],
      sourceIds: [
        stableId("source-record", ["chembl", stringValue(activity.activity_id) ?? targetName]),
      ],
      fetchedAt,
    });
  }

  return {
    compounds: [compound],
    targets: [...targetMap.values()],
    interactions,
    publications: [],
    sourceRecords: [
      cacheRecord({
        source: "chembl",
        externalId: chemblId,
        title: `ChEMBL molecule and activities: ${preferredName}`,
        url: `https://www.ebi.ac.uk/chembl/compound_report_card/${chemblId}/`,
        payload: { search: searchPayload, activities: activityPayload },
        fetchedAt,
      }),
    ],
    sourceStatus: [sourceStatus("chembl", "succeeded", interactions.length + 1, fetchedAt)],
  };
}

async function fetchPubMed(name: string, fetchedAt: string): Promise<NeuropharmConnectorBundle> {
  const term = `${name} receptor pharmacology cognition`;
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&term=${encodeURIComponent(term)}`;
  const searchPayload = await fetchJson(searchUrl);
  const idList = isRecord(searchPayload)
    ? isRecord(searchPayload.esearchresult) && Array.isArray(searchPayload.esearchresult.idlist)
      ? searchPayload.esearchresult.idlist.filter(
          (item): item is string => typeof item === "string",
        )
      : []
    : [];
  const summaryUrl =
    idList.length > 0
      ? `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${idList.join(",")}`
      : searchUrl;
  const summaryPayload = idList.length > 0 ? await fetchJson(summaryUrl) : searchPayload;
  const result =
    isRecord(summaryPayload) && isRecord(summaryPayload.result) ? summaryPayload.result : {};
  const publications = idList.flatMap((id) => {
    const row = result[id];
    if (!isRecord(row)) return [];
    const pubdate = stringValue(row.pubdate);
    const year = pubdate ? Number.parseInt(pubdate.slice(0, 4), 10) : undefined;
    return [
      {
        publicationId: `pubmed-${id}`,
        source: "pubmed" as const,
        title: stringValue(row.title) ?? `PubMed record ${id}`,
        journal: stringValue(row.fulljournalname) ?? stringValue(row.source),
        ...(Number.isFinite(year) ? { year } : {}),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        sourceIds: [stableId("source-record", ["pubmed", id])],
        fetchedAt,
      },
    ];
  });
  return {
    compounds: [],
    targets: [],
    interactions: [],
    publications,
    sourceRecords: [
      cacheRecord({
        source: "pubmed",
        externalId: term,
        title: `PubMed literature search: ${term}`,
        url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}`,
        payload: { search: searchPayload, summaries: summaryPayload },
        fetchedAt,
      }),
    ],
    sourceStatus: [sourceStatus("pubmed", "succeeded", publications.length, fetchedAt)],
  };
}

function mergeBundles(
  bundles: ReadonlyArray<NeuropharmConnectorBundle>,
): NeuropharmConnectorBundle {
  const compounds = new Map<string, NeuropharmCompoundIdentity>();
  const targets = new Map<string, NeuropharmTargetRecord>();
  const interactions = new Map<string, NeuropharmInteractionRecord>();
  const publications = new Map<string, NeuropharmPublicationRecord>();
  const sourceRecords = new Map<string, NeuropharmCachedSourceRecord>();
  const sourceStatus: NeuropharmDatabaseSourceStatus[] = [];
  for (const bundle of bundles) {
    bundle.compounds.forEach((entry) => compounds.set(entry.compoundId, entry));
    bundle.targets.forEach((entry) => targets.set(entry.targetId, entry));
    bundle.interactions.forEach((entry) => interactions.set(entry.interactionId, entry));
    bundle.publications.forEach((entry) => publications.set(entry.publicationId, entry));
    bundle.sourceRecords.forEach((entry) => sourceRecords.set(entry.sourceRecordId, entry));
    sourceStatus.push(...bundle.sourceStatus);
  }
  return {
    compounds: [...compounds.values()],
    targets: [...targets.values()],
    interactions: [...interactions.values()],
    publications: [...publications.values()],
    sourceRecords: [...sourceRecords.values()],
    sourceStatus,
  };
}

export async function fetchNeuropharmDatabaseBundle(input: {
  readonly compounds: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<Exclude<NeuropharmDatabaseSource, "bindingdb">>;
  readonly fetchedAt: string;
}): Promise<NeuropharmConnectorBundle> {
  const compounds = input.compounds.length > 0 ? input.compounds : [...DEFAULT_COMPOUNDS];
  const seed = buildCuratedSeedBundle(compounds, input.fetchedAt);
  const bundles: NeuropharmConnectorBundle[] = [seed];
  for (const source of input.sources) {
    for (const compound of compounds) {
      try {
        if (source === "pubchem") bundles.push(await fetchPubChem(compound, input.fetchedAt));
        if (source === "chembl") bundles.push(await fetchChembl(compound, input.fetchedAt));
        if (source === "iuphar") bundles.push(await fetchIuphar(compound, input.fetchedAt));
        if (source === "pubmed") bundles.push(await fetchPubMed(compound, input.fetchedAt));
      } catch (cause) {
        bundles.push({
          compounds: [],
          targets: [],
          interactions: [],
          publications: [],
          sourceRecords: [],
          sourceStatus: [sourceStatus(source, "failed", 0, input.fetchedAt, cause)],
        });
      }
    }
  }
  return mergeBundles(bundles);
}
