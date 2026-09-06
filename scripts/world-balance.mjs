import { createServer } from "vite";

const vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
try {
  const { defaultN } = await vite.ssrLoadModule("/src/lib/numbers.ts");
  const { simulateWorldBalance, worldBalanceSummary } = await vite.ssrLoadModule("/src/lib/world-balance.ts");
  const report = simulateWorldBalance(defaultN());
  console.log(worldBalanceSummary(report));
  process.exitCode = report.issues.some((issue) => issue.severity === "error") ? 1 : 0;
} finally {
  await vite.close();
}
