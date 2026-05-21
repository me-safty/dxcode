# Neuropharm Research

Neuropharm Research is a local-first neuropharmacology workspace for analyzing pharmacological compounds, receptor interactions, and cognitive effects using curated databases from PubChem, ChEMBL, IUPHAR, and PubMed.

The interface provides research-focused tools for compound profiling, interaction checking, evidence grading, pharmacokinetic analysis, and generating publication-ready reports with confidence ratings.

## Features

- **Compound Analysis**: Analyze receptor binding, pharmacokinetics, drug interactions, and mechanism of action with confidence-rated summaries
- **Receptor Atlas**: Explore neurotransmitter receptors, transporters, and signaling pathways with cognitive function mapping
- **Interaction Checker**: Identify drug-drug interactions, metabolic conflicts, and safety concerns when combining compounds
- **Cognitive Effects**: Evaluate impact on attention, memory, and executive function with dose-response curves and tolerance patterns
- **Pharmacokinetics**: Estimate onset time, peak concentration, half-life, and active metabolites based on published data
- **Evidence Database**: Integrates data from PubMed, PubChem, ChEMBL, and IUPHAR with source tracking and confidence grading
- **Visualizations**: Generate receptor selectivity radars, dose-response curves, interaction heatmaps, and pharmacokinetic timelines
- **Export Reports**: Create formatted research documents with citations, figures, and confidence ratings in LaTeX format

## Pharmacology Database

The app supports a local receptor database under the default 1.5 GB cap. The
manifest is intentionally focused on pharmacology rows that can be searched and
used for graph grounding:

- IUPHAR/BPS Guide to Pharmacology interactions TSV.
- IUPHAR ligand, target/family, and physicochemical TSV references.
- BindingDB all-measurements TSV archive.
- BindingDB ChEMBL, PubChem, patent, article, assay, PDSP Ki, and identifier
  mapping TSV archives.

Large multi-GB archives such as ChEMBL SQLite and BindingDB all-2D/all-3D SDF
files are not part of the default local download set.

Downloaded local database files live outside the repo under:

```text
~/.t3/dev/neuropharm/databases
```

SQLite app state lives under the configured T3 state directory. The repository
stores source code, migrations, contracts, tests, prompt policy, and the tracker
template/artifact, not the downloaded public database archives.

## Scientific Graphs and Visualizations

The application renders structured neuropharmacology graphs with evidence grading:

```neuropharm-graph
{"kind":"target_network","title":"AF710B local target map","data":[{"label":"M1 muscarinic acetylcholine receptor","value":62,"group":"AF710B","unit":"inferred"}],"notes":["Values are evidence-weighted graph scores, not clinical effect sizes."]}
```

Supported visualization types include:

- `target_network` - Receptor binding strengths by evidence grade
- `receptor_selectivity_radar` - Normalized selectivity profile
- `interaction_risk_heatmap` - Risk matrix for drug combinations
- `task_domain_matrix` - Cognitive domain effects
- `pk_timeline` - Pharmacokinetic profile
- `dose_response` - Dose-response curves
- `effect_size_forest` - Effect size comparisons
- `inverted_u_curve` - Inverted-U response patterns
- `molecule_property_card` - Molecular properties
- `similarity_map` - Compound similarity mapping
- `admet_radar` - ADMET profile visualization

Mermaid diagrams should use simple `flowchart LR` or `flowchart TD` syntax so
they render reliably in chat.

## Research posture

This is a research and analysis tool. It can discuss evidence, uncertainty,
mechanistic extrapolation, literature ranges, protocol context, receptor
pharmacology, and risk flags. It must not present personalized diagnosis,
treatment, prescribing, emergency guidance, or individualized medical
instructions.

Claims should be separated by evidence class:

- Human
- Animal
- In-vitro
- In-silico
- Anecdotal
- Low-confidence extrapolation

Unsupported claims should be labeled as assumptions or unknowns. Exact receptor
affinities, PK values, contraindications, or study outcomes should not be
invented when the local database or cited literature does not contain them.

## Repository layout

- `apps/server`: Node/Effect backend, WebSocket RPC, SQLite persistence,
  neuropharm services, database connectors, local database downloader/importer,
  and prompt policy.
- `apps/web`: React/Vite UI, chat rendering, database console, research console,
  graph renderer, and neuropharm workspace panels.
- `apps/desktop`: Desktop shell around the web/server runtime.
- `packages/contracts`: Shared schemas for RPC, IPC, neuropharm records,
  graph specs, local database status, and analysis results.
- `output/neuropharm-tracker`: Local XLSX research tracker artifact.
- `repo_plan`: Repository Planning Graph run artifacts for this conversion.

## Development

Install dependencies:

```bash
bun install .
```

Run local development:

```bash
bun run dev
```

Run the core verification gates:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Targeted neuropharm checks:

```bash
bun run --filter t3 test src/neuropharm/NeuropharmService.test.ts src/neuropharm/NeuropharmPromptPolicy.test.ts
bun run --filter @t3tools/contracts test src/neuropharm.test.ts
bun run --filter @t3tools/web test:browser src/components/ChatMarkdown.browser.tsx
```

Do not use `bun test`; use `bun run test`.
