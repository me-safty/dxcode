import {
  ActivityIcon,
  BrainIcon,
  DatabaseIcon,
  FileTextIcon,
  FlaskConicalIcon,
  NetworkIcon,
  ShieldAlertIcon,
  SigmaIcon,
} from "lucide-react";

const items = [
  {
    icon: FlaskConicalIcon,
    label: "Compound profiles",
    text: "Targets, receptor selectivity, PK/PD, interactions, confidence, graphs, and report artifacts.",
  },
  {
    icon: NetworkIcon,
    label: "Receptor atlas",
    text: "Receptors, transporters, pathways, ligand classes, signaling, and cognition links.",
  },
  {
    icon: ShieldAlertIcon,
    label: "Stack checker",
    text: "Mechanism overlap, CYP/transporter issues, safety flags, and interaction heatmaps.",
  },
  {
    icon: BrainIcon,
    label: "Cognitive enhancement",
    text: "Task domains, inverted-U curves, effect sizes, tolerance, fatigue, and uncertainty labels.",
  },
  {
    icon: ActivityIcon,
    label: "PK/PD estimates",
    text: "Onset, tmax, half-life, accumulation, active metabolites, and source-linked assumptions.",
  },
  {
    icon: DatabaseIcon,
    label: "Evidence graph",
    text: "PubMed, PubChem, ChEMBL, IUPHAR, PDFs, URLs, CSV, notes, claims, and relationships.",
  },
  {
    icon: SigmaIcon,
    label: "Standard figures",
    text: "Dose-response, radar, timeline, heatmap, forest, inverted-U, ADMET, and network graphs.",
  },
  {
    icon: FileTextIcon,
    label: "LaTeX reports",
    text: "Structured research reports with citations, tables, diagrams, graph specs, and caveats.",
  },
];

export function NeuropharmWorkspacePanel() {
  return (
    <div className="grid gap-3 text-left sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-border/70 bg-background/70 p-3">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            <item.icon className="size-4 text-emerald-600" />
            {item.label}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{item.text}</p>
        </div>
      ))}
    </div>
  );
}
