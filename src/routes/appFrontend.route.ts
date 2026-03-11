import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";

function publicFilePath(filename: string) {
  return path.join(process.cwd(), "public", filename);
}

async function sendPublicFile(reply: any, filename: string, contentType: string) {
  const file = await readFile(publicFilePath(filename), "utf8");
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "no-store");
  return reply.send(file);
}

export async function registerAppFrontendRoutes(app: FastifyInstance) {
  app.get("/app", async (_req, reply) => {
    return sendPublicFile(reply, "app.html", "text/html; charset=utf-8");
  });

  app.get("/app.css", async (_req, reply) => {
    return sendPublicFile(reply, "app.css", "text/css; charset=utf-8");
  });

  app.get("/app.js", async (_req, reply) => {
    return sendPublicFile(reply, "app.js", "application/javascript; charset=utf-8");
  });
}