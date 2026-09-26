import { describe, expect, it } from "vitest";
import { incomingCityMarches, recentCityScan } from "./city-alerts";
import type { LiveMarch } from "./realtime";

const march = (patch: Partial<LiveMarch> = {}): LiveMarch => ({
  id: "attack-1", attacker: "0xenemy", defender: "0xme",
  attackerName: "Enemy", defenderName: "Me", from: { x: 9, y: 8 }, to: { x: 1, y: 2 },
  departAt: 1000, arriveAt: 5000, armyTotal: 100, ...patch,
});
describe("City realtime alerts", () => {
  it("restores only live incoming marches from reconnect snapshots", () => {
    const data = [march(), march({id:"outgoing",attacker:"0xme",defender:"0xenemy"}),
      march({id:"expired",arriveAt:1500}), march({id:"other",defender:"0xother"})];
    expect(incomingCityMarches("0xME", data, 2000).map(m=>m.id)).toEqual(["attack-1"]);
  });
  it("deduplicates snapshot/live overlap and retains simultaneous attackers", () => {
    expect(incomingCityMarches("0xme",[march(),march({armyTotal:200}),march({id:"attack-2"})],2000)
      .map(m=>[m.id,m.armyTotal])).toEqual([["attack-1",200],["attack-2",100]]);
  });
  it("expires at arrival and ignores malformed server timers", () => {
    expect(incomingCityMarches("0xme",[march()],5000)).toEqual([]);
    expect(incomingCityMarches("0xme",[march({arriveAt:NaN}),march({departAt:9000})],2000)).toEqual([]);
  });
  it("does not replay old scans or mistake outgoing battle reports for an attack", () => {
    expect(recentCityScan({id:"scan",kind:"scouted",ts:1000},2000)).toBe(true);
    expect(recentCityScan({id:"scan",kind:"scouted",ts:1000},5500)).toBe(false);
    expect(recentCityScan({id:"scan",kind:"scouted",ts:3000},2000)).toBe(false);
    expect(recentCityScan({id:"battle",kind:"battle",ts:1000},2000)).toBe(false);
  });
});
