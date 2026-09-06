import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Town from "./Town";

describe("Town troop training UI", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows T1 as trainable and higher tiers as training-building-gated", () => {
    const html = renderToStaticMarkup(
      <Town
        address="0xrender"
        onWorld={() => {}}
        profile={{
          address: "0xrender",
          name: "Ruglord0000001",
          faction: null,
          factionSymbol: null,
          keepLevel: 1,
          createdAt: "2026-09-05T00:00:00.000Z",
          renamedOnce: false,
        }}
      />,
    );

    expect(html).toContain("Train 10.00K T1");
    expect(html).toContain("ATK 6 · DEF 6 · MIGHT 2");
    expect(html).toContain("Army Camp");
    expect(html).toContain('title="Requires Army Camp Lv.3"');
  });

  it("shows player cheat controls for a locally granted GM wallet", () => {
    vi.stubGlobal("window", { location: { hostname: "localhost", search: "?gm" } });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "ruglands:gm:0xrender" ? "1" : null,
    });

    const html = renderToStaticMarkup(
      <Town
        address="0xrender"
        onWorld={() => {}}
        profile={{
          address: "0xrender",
          name: "Ruglord0000001",
          faction: null,
          factionSymbol: null,
          keepLevel: 1,
          createdAt: "2026-09-05T00:00:00.000Z",
          renamedOnce: false,
        }}
      />,
    );

    expect(html).toContain("Local GM tools");
    expect(html).toContain("Fill resources");
    expect(html).toContain("Fill troops");
    expect(html).toContain("Finish queues");
    expect(html).toContain("Townhall +1");
    expect(html).toContain("Selected building +1");
    expect(html).toContain("Reset city");
    expect(html).toContain("Disable GM");
  });
});
