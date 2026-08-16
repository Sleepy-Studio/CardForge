import { server } from "./app.config.js";
import { cardForgeStore } from "./store.js";
import { launchLiveOps } from "@cardforge/live-ops";

const configuredPort = Number.parseInt(process.env.PORT ?? "2567", 10);
const port = Number.isInteger(configuredPort) ? configuredPort : 2567;

await cardForgeStore.migrate();
const storedLiveOps = await cardForgeStore.listLiveOpsDefinitions();
if (!storedLiveOps.some((item) => item.configId === launchLiveOps.configId))
  await cardForgeStore.saveLiveOpsDefinition(launchLiveOps);
await server.listen(port);
console.log(`[CardForge] authoritative match server listening on ${port}`);

export { server } from "./app.config.js";
export * from "./action-clock.js";
export * from "./intents.js";
export * from "./room.js";
export * from "./session.js";
export * from "./store.js";
