import type {
  NeuropharmBasicsPackResult,
  NeuropharmCompoundComparisonResult,
  NeuropharmDatabaseSyncResult,
  NeuropharmEvidenceGrade,
  NeuropharmLocalDatabaseDownloadResult,
  NeuropharmLocalDatabaseSource,
  NeuropharmLocalDatabaseStatusResult,
  NeuropharmLocalSearchResult,
} from "@t3tools/contracts";
import {
  DatabaseIcon,
  DownloadCloudIcon,
  FlaskConicalIcon,
  HardDriveIcon,
  LibraryIcon,
  LinkIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { usePrimaryEnvironmentId } from "../../environments/primary";
import { readEnvironmentApi } from "../../environmentApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScientificGraphRenderer } from "./ScientificGraphRenderer";

const DEFAULT_COMPARISON = "AF710B, methylphenidate";

function gradeVariant(grade: NeuropharmEvidenceGrade) {
  if (grade === "measured") return "success" as const;
  if (grade === "inferred") return "warning" as const;
  return "outline" as const;
}

function parseCompounds(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function DatabaseConsole() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [compoundText, setCompoundText] = useState(DEFAULT_COMPARISON);
  const [syncResult, setSyncResult] = useState<NeuropharmDatabaseSyncResult | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<NeuropharmLocalDatabaseStatusResult | null>(
    null,
  );
  const [downloadResult, setDownloadResult] =
    useState<NeuropharmLocalDatabaseDownloadResult | null>(null);
  const [basicsPack, setBasicsPack] = useState<NeuropharmBasicsPackResult | null>(null);
  const [localSearch, setLocalSearch] = useState<NeuropharmLocalSearchResult | null>(null);
  const [comparison, setComparison] = useState<NeuropharmCompoundComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<
    "basics" | "download" | "status" | "sync" | "search" | "compare" | null
  >(null);

  const api = primaryEnvironmentId ? readEnvironmentApi(primaryEnvironmentId) : undefined;

  const currentLocalSources = useCallback((): NeuropharmLocalDatabaseSource[] => {
    return databaseStatus?.manifest.map((entry) => entry.source) ?? [];
  }, [databaseStatus]);

  const refreshDatabaseStatus = useCallback(async () => {
    setRunning((current) => current ?? "status");
    setError(null);
    try {
      if (!api) throw new Error("Neuropharm database not connected.");
      setDatabaseStatus(await api.neuropharm.databaseStatus({}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Database status failed.");
    } finally {
      setRunning((current) => (current === "status" ? null : current));
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    void refreshDatabaseStatus();
  }, [api, refreshDatabaseStatus]);

  const downloadAllDatabases = async () => {
    setRunning("download");
    setError(null);
    try {
      if (!api) throw new Error("Neuropharm database not connected.");
      const sources = currentLocalSources();
      const result = await api.neuropharm.downloadDatabases({
        ...(sources.length > 0 ? { sources } : {}),
        forceRefresh: false,
        importAfterDownload: true,
      });
      setDownloadResult(result);
      setDatabaseStatus(await api.neuropharm.databaseStatus({}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Database download failed.");
    } finally {
      setRunning(null);
    }
  };

  const installBasicsPack = async () => {
    setRunning("basics");
    setError(null);
    try {
      if (!api) throw new Error("Neuropharm database not connected.");
      const result = await api.neuropharm.installBasicsPack({ forceRefresh: false });
      setBasicsPack(result);
      const sources = currentLocalSources();
      setLocalSearch(
        await api.neuropharm.searchLocalInteractions({
          query: compoundText,
          ...(sources.length > 0 ? { sources } : {}),
          limit: 20,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Basics pack install failed.");
    } finally {
      setRunning(null);
    }
  };

  const syncDatabase = async () => {
    setRunning("sync");
    setError(null);
    try {
      if (!api) throw new Error("Neuropharm database not connected.");
      const result = await api.neuropharm.syncDatabases({
        compounds: parseCompounds(compoundText),
        sources: ["pubchem", "chembl", "iuphar", "pubmed", "bindingdb"],
      });
      setSyncResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Database sync failed.");
    } finally {
      setRunning(null);
    }
  };

  const searchLocalDatabases = async () => {
    setRunning("search");
    setError(null);
    try {
      if (!api) throw new Error("Neuropharm database not connected.");
      const sources = currentLocalSources();
      setLocalSearch(
        await api.neuropharm.searchLocalInteractions({
          query: compoundText,
          ...(sources.length > 0 ? { sources } : {}),
          limit: 20,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local database search failed.");
    } finally {
      setRunning(null);
    }
  };

  const compareCompounds = async () => {
    setRunning("compare");
    setError(null);
    try {
      if (!api) throw new Error("Neuropharm database not connected.");
      const compounds = parseCompounds(compoundText);
      if (compounds.length < 2) throw new Error("Enter at least two compounds.");
      const result = await api.neuropharm.compareCompounds({
        compounds,
        focus: ["M1", "sigma-1", "DAT", "NET", "cognition"],
        includeSpeculative: false,
      });
      setComparison(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Compound comparison failed.");
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="rounded-md border border-border bg-background/80 p-4 text-left">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <DatabaseIcon className="size-4 text-sky-600" />
          Pharmacology database
        </div>
        {databaseStatus ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <HardDriveIcon className="size-3" />
            {formatBytes(databaseStatus.totalBytes)}
          </Badge>
        ) : null}
        <div className="min-w-64 flex-1">
          <Input
            nativeInput
            value={compoundText}
            onChange={(event) => setCompoundText(event.currentTarget.value)}
            aria-label="Compounds to sync and compare"
            placeholder="Enter compounds to compare (e.g., modafinil, methylphenidate)"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={installBasicsPack}
          disabled={running !== null}
        >
          <LibraryIcon className="size-3.5" />
          {running === "basics" ? "Loading data..." : "Load starter data"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={downloadAllDatabases}
          disabled={running !== null}
        >
          <DownloadCloudIcon className="size-3.5" />
          {running === "download" ? "Downloading..." : "Download databases"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={searchLocalDatabases}
          disabled={running !== null}
        >
          <SearchIcon className="size-3.5" />
          {running === "search" ? "Searching..." : "Search database"}
        </Button>
        <Button type="button" variant="outline" onClick={syncDatabase} disabled={running !== null}>
          <RefreshCwIcon className="size-3.5" />
          {running === "sync" ? "Fetching..." : "Fetch latest data"}
        </Button>
        <Button type="button" onClick={compareCompounds} disabled={running !== null}>
          <FlaskConicalIcon className="size-3.5" />
          {running === "compare" ? "Analyzing..." : "Compare compounds"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-amber-300/50 bg-amber-50/60 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          {error}
        </div>
      ) : null}

      {databaseStatus ? (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          {databaseStatus.snapshots.map((snapshot) => (
            <div key={snapshot.source} className="rounded-md border border-border/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium uppercase">{snapshot.source}</span>
                <Badge
                  variant={
                    snapshot.status === "failed"
                      ? "warning"
                      : snapshot.status === "imported" || snapshot.status === "downloaded"
                        ? "success"
                        : "outline"
                  }
                >
                  {snapshot.status.replace("_", " ")}
                </Badge>
              </div>
              <div className="mt-1 truncate text-muted-foreground" title={snapshot.filePath}>
                {snapshot.filePath ?? "No local file yet"}
              </div>
              <div className="mt-1 text-muted-foreground">
                {formatBytes(snapshot.bytes ?? 0)} · {snapshot.rowCount} imported row
                {snapshot.rowCount === 1 ? "" : "s"}
              </div>
              {databaseStatus.manifest.find((entry) => entry.source === snapshot.source)
                ?.estimatedSizeBytes ? (
                <div className="mt-1 text-muted-foreground">
                  est.{" "}
                  {formatBytes(
                    databaseStatus.manifest.find((entry) => entry.source === snapshot.source)
                      ?.estimatedSizeBytes ?? 0,
                  )}
                </div>
              ) : null}
              {snapshot.rowCount === 0 && snapshot.status === "downloaded" ? (
                <div className="mt-1 text-muted-foreground">
                  Archive downloaded. Data import in progress.
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {downloadResult?.warnings.length ? (
        <div className="mt-3 rounded-md border border-amber-300/50 bg-amber-50/60 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          {downloadResult.warnings.join(" ")}
        </div>
      ) : null}

      {basicsPack ? (
        <div className="mt-3 rounded-md border border-border/70 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">Basics pack installed</div>
            <Badge variant="success">{basicsPack.imported.length} local notes</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {basicsPack.topics.map((topic) => (
              <Badge key={topic} variant="outline">
                {topic}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {syncResult ? (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
          {syncResult.sourceStatus.map((status) => (
            <div
              key={`${status.source}:${status.fetchedAt ?? status.status}`}
              className="rounded-md border border-border/70 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium uppercase">{status.source}</span>
                <Badge variant={status.status === "failed" ? "warning" : "success"}>
                  {status.status}
                </Badge>
              </div>
              <div className="mt-1 text-muted-foreground">
                {status.records} record{status.records === 1 ? "" : "s"}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {localSearch ? (
        <div className="mt-4 rounded-md border border-border/70 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium">Local evidence rows for "{localSearch.query}"</div>
            <Badge variant="outline">{localSearch.interactions.length} interactions</Badge>
          </div>
          <div className="mt-3 overflow-hidden rounded-md border border-border/70">
            <table className="w-full table-fixed">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="w-[22%] px-3 py-2 text-left font-medium">Compound</th>
                  <th className="w-[30%] px-3 py-2 text-left font-medium">Receptor/Target</th>
                  <th className="w-[18%] px-3 py-2 text-left font-medium">Database</th>
                  <th className="px-3 py-2 text-left font-medium">Binding affinity</th>
                </tr>
              </thead>
              <tbody>
                {localSearch.interactions.slice(0, 8).map((interaction) => (
                  <tr key={interaction.interactionId} className="border-t border-border/70">
                    <td className="px-3 py-2 align-top">{interaction.compoundName}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {interaction.targetName}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Badge variant={gradeVariant(interaction.evidenceGrade)}>
                        {interaction.source}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {interaction.value !== undefined
                        ? `${interaction.relation ?? ""}${interaction.value} ${interaction.units ?? ""}`
                        : (interaction.action ?? "database relationship")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {comparison ? (
        <div className="mt-4 space-y-4">
          <div>
            <div className="text-sm font-medium">{comparison.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {comparison.compounds.length} compounds, {comparison.targets.length} targets,{" "}
              {comparison.interactions.length} interactions, {comparison.publications.length}{" "}
              publications.
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-border/70">
            <table className="w-full table-fixed text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="w-[18%] px-3 py-2 text-left font-medium">Compound</th>
                  <th className="w-[28%] px-3 py-2 text-left font-medium">Receptor/Target</th>
                  <th className="w-[16%] px-3 py-2 text-left font-medium">Grade</th>
                  <th className="w-[16%] px-3 py-2 text-left font-medium">Value</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {comparison.interactions.slice(0, 10).map((interaction) => (
                  <tr key={interaction.interactionId} className="border-t border-border/70">
                    <td className="px-3 py-2 align-top">{interaction.compoundName}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {interaction.targetName}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Badge variant={gradeVariant(interaction.evidenceGrade)}>
                        {interaction.evidenceGrade}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-top tabular-nums">
                      {interaction.value !== undefined
                        ? `${interaction.relation ?? ""}${interaction.value} ${interaction.units ?? ""}`
                        : "not extracted"}
                    </td>
                    <td className="px-3 py-2 align-top text-muted-foreground">
                      {interaction.action ?? interaction.measurementType ?? "database relationship"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {comparison.graphSpecs.map((spec) => (
              <ScientificGraphRenderer key={`${spec.kind}:${spec.title}`} spec={spec} />
            ))}
          </div>

          <div className="grid gap-3 text-xs lg:grid-cols-2">
            <div className="rounded-md border border-border/70 p-3">
              <div className="mb-2 font-medium">Evidence summary</div>
              <ul className="space-y-1 text-muted-foreground">
                {comparison.evidenceSummary.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border/70 p-3">
              <div className="mb-2 flex items-center gap-1.5 font-medium">
                <LinkIcon className="size-3.5 text-sky-600" />
                Sources
              </div>
              <div className="space-y-1 text-muted-foreground">
                {comparison.publications.slice(0, 4).map((publication) => (
                  <a
                    key={publication.publicationId}
                    href={publication.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate hover:text-foreground"
                  >
                    {publication.title}
                  </a>
                ))}
                {comparison.publications.length === 0 ? (
                  <div>No publications loaded yet.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
