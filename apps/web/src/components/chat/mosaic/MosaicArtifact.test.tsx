import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_MANIFEST, parse, validate } from "@mosaicjs/core";

import { mosaicComponents } from "./blocks";
import { MosaicArtifact } from "./MosaicArtifact";

describe("MosaicArtifact", () => {
  it("renders an artifact through t3code's own block components", () => {
    const source = `<Card><Heading level={3}>Ship it</Heading><Text>All checks passed.</Text></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Ship it");
    expect(markup).toContain("All checks passed.");
  });

  it("evaluates a native expression locally at render time", () => {
    const source = `<Stat label="Answer" value={6 * 7} />`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("42");
  });

  it("bakes initial state and evaluates template literals", () => {
    const source = "<Card state={{ seats: 12 }}><Text>{`Seats: ${seats}`}</Text></Card>";
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Seats: 12");
  });

  it("renders a conditional child via plain JSX &&", () => {
    const source = `<Card state={{ seats: 120 }}>{seats >= 100 && <Callout tone="warn">Enterprise</Callout>}</Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Enterprise");
  });

  it("renders a list via plain JSX .map", () => {
    const source = `<Card state={{ items: [{ name: "alpha" }, { name: "beta" }] }}>{items.map((i) => <Text key={i.name}>{i.name}</Text>)}</Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("alpha");
    expect(markup).toContain("beta");
  });
});

describe("MosaicArtifact streaming", () => {
  it("renders a still-streaming partial artifact progressively", () => {
    const source = `<Card><Heading level={3}>Building</Heading><Text>partial sentence`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} isStreaming />);
    expect(markup).toContain("Building");
    expect(markup).toContain("partial sentence");
  });

  it("shows raw source quietly while nothing is renderable yet", () => {
    const markup = renderToStaticMarkup(<MosaicArtifact source={"<Car"} isStreaming />);
    expect(markup).toContain("&lt;Car");
    expect(markup).not.toContain("Could not render");
  });
});

describe("block rendering", () => {
  it("renders markdown passed to <Markdown> as children (not literal ** )", () => {
    const source = `<Markdown>**Why this is elevated** - repeated deposits.</Markdown>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("<strong>Why this is elevated</strong>");
    expect(markup).not.toContain("**Why this is elevated**");
  });

  it("renders best-effort instead of blanking on an invalid block", () => {
    // Chart is missing its required data - validation is advisory, so the rest
    // of the artifact still renders and the diagnostics go to the agent.
    const source = `<Card><Text>Still visible</Text><Chart type="bar" alt="x" /></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Still visible");
    expect(markup).not.toContain("Could not render");
  });

  it("does not dump raw JSON when a value is the wrong (object) shape", () => {
    const source = `<Stat label="x" value={{ a: 1 }} />`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).not.toContain('{"a":1}');
    expect(markup).not.toContain("&quot;a&quot;");
  });
});

describe("layout & density (t3code's own baked defaults)", () => {
  it("renders an action row: text left, buttons right, with a subtle inline action", () => {
    const source = `<Card>
  <Text variant="label" tone="subtle">Needs a quick yes</Text>
  <Stack direction="horizontal" justify="between" align="center">
    <Text>Pay invoice</Text>
    <Stack direction="horizontal">
      <Button variant="primary">Approve</Button>
      <Button variant="subtle">Skip</Button>
    </Stack>
  </Stack>
</Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("justify-between");
    // Text variant="label" is the section micro-label: uppercase treatment.
    expect(markup).toContain("uppercase");
    expect(markup).toContain("Approve");
    expect(markup).toContain("Skip");
  });

  it("renders a Card with baked compact padding and rhythm-spaced children", () => {
    // The format carries no spacing props: the Card keeps its baked padding and
    // spaces successive children by contextual rhythm, not one flat gap.
    const source = `<Card><Text>First</Text><Text>Second</Text></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("p-3.5");
    expect(markup).toContain("mt-2"); // text -> text default rhythm
  });

  it("groups adjacent cards with a modest gap, not a section break", () => {
    const source = `<Card><Card>A</Card><Card>B</Card></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("mt-2"); // card -> card reads as one group
  });

  it("tints a toned card into an inset panel", () => {
    const source = `<Card tone="ok"><Text>Sorted 38 emails</Text></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("bg-success/8");
  });

  it("surfaces a REMOVED_PROP diagnostic for a removed spacing prop while still rendering", () => {
    // A removed 0.6 prop (gap) is advisory: the artifact still renders, and the
    // validation the library feeds onDiagnostics flags it for the agent to fix.
    const source = `<Card gap="2"><Text>Compact</Text></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Compact");

    const parsed = parse(source);
    expect(parsed.ok).toBe(true);
    const checked = parsed.ok ? validate(parsed.doc, DEFAULT_MANIFEST) : null;
    expect(checked?.ok).toBe(false);
    const diagnostics = checked && !checked.ok ? checked.errors : [];
    expect(diagnostics.some((d) => d.code === "REMOVED_PROP" && d.prop === "gap")).toBe(true);
  });
});

describe("contextual rhythm (spacing derives from adjacent structure)", () => {
  // The user's morning-briefing card: a full composition the rhythm engine must
  // give visible hierarchy - tight header cluster, section breaks before each
  // micro-label, grouped/sectioned cards, a tight badge stack, and a callout whose
  // body separates its button row from the message.
  const briefing = `<Card state={{ carBooked: false, carDismissed: false }}>
  <Stack direction="horizontal" align="center">
    <Icon name="sunrise" />
    <Stack>
      <Heading level={3}>Good morning, Alex</Heading>
      <Text variant="caption">Tuesday · 8:00am · 12°C, clear</Text>
    </Stack>
  </Stack>
  <Text variant="label">On your calendar</Text>
  <DataTable columns={["Time", "Event", "Status"]} rows={[["10:00", "Standup", "prep note ready"], ["14:30", "Client call — Meridian", "brief attached"], ["18:40", "Flight BA294", "checked in"]]} />
  <Card tone="ok">
    <Text variant="label">Handled while you slept</Text>
    <Stack>
      <Badge icon="circle-check" tone="ok">Sorted 38 emails</Badge>
      <Badge icon="circle-check" tone="ok">Drafted 2 replies</Badge>
    </Stack>
  </Card>
  <Text variant="label">Needs a quick yes</Text>
  <Card>
    <Stack direction="horizontal" justify="between" align="center">
      <Stack direction="horizontal" align="center"><Icon name="wallet" /><Text>Pay £340 invoice to Studio Kern</Text></Stack>
      <Stack direction="horizontal"><Button variant="secondary">Approve</Button><Button variant="subtle">Skip</Button></Stack>
    </Stack>
  </Card>
  <Callout tone="primary" icon="lightbulb">
    <Stack>
      <Text>You land at 21:15 and it'll be raining. Want me to book a car?</Text>
      <Stack direction="horizontal"><Button variant="primary">Book it</Button><Button variant="subtle">No thanks</Button></Stack>
    </Stack>
  </Callout>
</Card>`;

  it("renders every layer of the briefing with its hierarchy intact", () => {
    const markup = renderToStaticMarkup(<MosaicArtifact source={briefing} />);
    expect(markup).toContain("Good morning, Alex");
    expect(markup).toContain("Sorted 38 emails");
    expect(markup).toContain("Book it");
  });

  it("sits the caption tight under the heading and rides the icon on the first line", () => {
    const source = `<Stack direction="horizontal" align="center"><Icon name="sunrise" /><Stack><Heading level={3}>Good morning, Alex</Heading><Text variant="caption">Tuesday</Text></Stack></Stack>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    // heading -> caption is a tight pair, not a full gap.
    expect(markup).toContain("mt-0.5");
    // Icon + multi-line block: the row tops the icon instead of centering it.
    expect(markup).toContain("items-start");
  });

  it("breaks a section before each micro-label and ties it tight to what follows", () => {
    const source = `<Card><Text>Intro</Text><Text variant="label">On your calendar</Text><DataTable columns={["A"]} rows={[["1"]]} /></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("mt-4"); // section break before the label
    expect(markup).toContain("mt-1.5"); // tight tie from label to the table
  });

  it("gives a section-level gap when a card crosses into a new kind", () => {
    const source = `<Card><DataTable columns={["A"]} rows={[["1"]]} /><Card tone="ok"><Text>Panel</Text></Card></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("mt-3"); // table -> card is a section boundary
  });

  it("separates a callout's button row from its message", () => {
    const source = `<Callout tone="primary" icon="lightbulb"><Stack><Text>Book a car?</Text><Stack direction="horizontal"><Button variant="primary">Book it</Button></Stack></Stack></Callout>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("mt-2.5"); // text -> control row
    expect(markup).toContain("items-start"); // icon tops the message
  });
});

describe("icons (Lucide standard)", () => {
  it("renders an Icon block for a valid Lucide name without crashing", () => {
    const source = `<Card><Icon name="circle-check" tone="ok" /><Text>Done</Text></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Done");
    expect(markup).not.toContain("circle-check"); // the raw name is never shown as text
  });

  it("renders a leading icon on a Badge alongside its label", () => {
    const source = `<Badge tone="warn" icon="wallet">Pay invoice</Badge>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Pay invoice");
    expect(markup).not.toContain("wallet");
  });

  it("ignores an unknown icon name instead of dumping it", () => {
    const source = `<Card><Icon name="definitely-not-an-icon" /><Text>Fine</Text></Card>`;
    const markup = renderToStaticMarkup(<MosaicArtifact source={source} />);
    expect(markup).toContain("Fine");
    expect(markup).not.toContain("definitely-not-an-icon");
  });
});

describe("mosaicComponents", () => {
  it("covers the layout, control, and data blocks a model composes from", () => {
    for (const block of [
      "Stack",
      "Grid",
      "Card",
      "Text",
      "Heading",
      "Badge",
      "Callout",
      "Button",
      "Slider",
      "Toggle",
      "Select",
      "Checkbox",
      "SegmentedControl",
      "Tabs",
      "DataTable",
      "Stat",
      "Chart",
      "Timeline",
      "Diagram",
    ]) {
      expect(mosaicComponents, `missing block: ${block}`).toHaveProperty(block);
    }
  });
});
