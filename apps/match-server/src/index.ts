import { server } from "./app.config.js";

const configuredPort = Number.parseInt(process.env.PORT ?? "2567", 10);
const port = Number.isInteger(configuredPort) ? configuredPort : 2567;

await server.listen(port);
console.log(`[CardForge] authoritative match server listening on ${port}`);

export { server } from "./app.config.js";
export * from "./action-clock.js";
export * from "./intents.js";
export * from "./room.js";
export * from "./session.js";
