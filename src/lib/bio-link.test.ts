import { describe, expect, it } from "vitest";
import { bioLooksLikeLink } from "./profile";

describe("bio link guard", () => {
  it("blocks links, domains, invites and wallet addresses", () => {
    for (const bio of ["claim at https://free-eth.xyz", "go to www.site.io", "airdrop-rhc.com now", "visit rugs dot com", "scam[.]io", "rugs (dot) finance", "pump.fun",
      "join t.me/pumpgroup", "discord.gg/abc", "send to 0x1234567890abcdef1234567890abcdef12345678", "sol 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"]) {
      expect(bioLooksLikeLink(bio), bio).toBe(true);
    }
  });
  it("lets normal introductions through", () => {
    for (const bio of ["Night shift on the outer ring. Say hi before you raid.", "Trader by day, raider by night.", "Core 12, looking for an alliance!", "GG. See you at the wormhole.", "I like .5 speedups", "Hello. Me too", "Come in. To the core we go", "Build. Win. Repeat."]) {
      expect(bioLooksLikeLink(bio), bio).toBe(false);
    }
  });
});
