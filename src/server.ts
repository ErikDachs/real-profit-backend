// src/server.ts
import { buildApp } from "./app.js";

const app = await buildApp();

// ✅ ensures all plugins/routes are fully registered
await app.ready();

// ✅ print all registered routes into Render logs
console.log("\n=== FASTIFY ROUTES ===\n" + app.printRoutes());

const port = Number(app.config.PORT);
await app.listen({ port, host: "0.0.0.0" });

console.log(`Server running on http://localhost:${port}`);