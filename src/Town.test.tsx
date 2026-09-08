import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Town from "./Town";
import { initGame } from "./lib/gamestore";

describe("Town troop training UI", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps detailed training controls behind the Army Camp facility", () => {
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

    expect(html).toContain("Army Camp");
    expect(html).toContain("Resource Network");
    expect(html).toContain("RESOURCE NETWORK");
    expect(html).toContain("BUILD QUEUE");
    expect(html).toContain("Daily Tasks");
    expect(html).toContain("CREDITS");
    expect(html).toContain('aria-label="Army Camp details"');
    expect(html).not.toContain("Army quantity");
    expect(html).not.toContain("Training grounds");
    expect(html).not.toContain("Trains Army units");
    expect(html).not.toContain("Training, promotion, healing and research controls");
    expect(html).toContain("CITY");
    expect(html).toContain("STAR MAP");
    expect(html).not.toContain("Enter the World");
    expect(html).not.toContain("No alliance");
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

    expect(html).toContain("LOCAL GM");
    expect(html).toContain("Fill resources");
    expect(html).toContain("Fill troops");
    expect(html).toContain("Finish queues");
    expect(html).toContain("Max research");
    expect(html).toContain("Open Research");
    expect(html).toContain("Townhall +1");
    expect(html).toContain("Selected building +1");
    expect(html).toContain("Reset city");
    expect(html).toContain("Disable GM");
  });

  it("renders a playable three-branch Academy with per-level gates, costs and time", () => {
    const game = initGame("0xacademy");
    game.buildings.keep.lvl = 4;
    game.buildings.academy.lvl = 1;
    game.res = { cash: 100_000, oil: 100_000, power: 100_000 };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === "ruglands:game:0xacademy" ? JSON.stringify(game) : null,
    });

    const html = renderToStaticMarkup(
      <Town
        address="0xacademy"
        onWorld={() => {}}
        profile={{
          address: "0xacademy", name: "Ruglord0000002", faction: null, factionSymbol: null,
          keepLevel: 4, createdAt: "2026-09-06T00:00:00.000Z", renamedOnce: false,
        }}
      />,
    );

    expect(html).toContain("Research Institute");
    expect(html).toContain('aria-label="Research Institute details"');
    expect(html).toContain("READY");
    expect(html).not.toContain("Rapid Construction I");
  });
});
