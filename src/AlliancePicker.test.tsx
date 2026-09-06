import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AlliancePicker from "./AlliancePicker";

describe("AlliancePicker", () => {
  it("contains alliance tokens only and never inserts Solo as an alliance", () => {
    const html = renderToStaticMarkup(
      <AlliancePicker
        alliances={[
          { ca: "0xfrog", symbol: "FROG", name: "Frog Army", icon: null },
          { ca: "0xcat", symbol: "CAT", name: "Cat Nation", icon: null },
        ]}
        selectedCA={null}
        onSelect={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Available alliances"');
    expect(html).toContain("$FROG");
    expect(html).toContain("$CAT");
    expect(html).not.toContain("Solo");
  });
});
