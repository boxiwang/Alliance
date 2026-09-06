import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Admin from "./Admin";

describe("Balance Lab", () => {
  it("opens on a human-readable pacing overview", () => {
    const html = renderToStaticMarkup(<Admin />);

    expect(html).toContain("RUGLANDS Balance Lab");
    expect(html).toContain("All checks passed");
    expect(html).toContain("Light");
    expect(html).toContain("Normal");
    expect(html).toContain("Active");
    expect(html).toContain("Progress checkpoints");
    expect(html).not.toContain("Open game as GM");
    expect(html).not.toContain("building.keep");
  });
});
