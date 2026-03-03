import { buildApp } from "./app.js";
const app = await buildApp();
const port = Number(app.config.PORT);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Server running on http://localhost:${port}`);
