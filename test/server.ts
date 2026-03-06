import { OpenAPIGenerator } from "@orpc/openapi";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { drizzle } from "drizzle-orm/libsql";
import { z } from "zod";

import { crud } from "../src";
import front from "./index.html";
import * as schema from "./schema";

const env = z
  .object({
    DATABASE_URL: z.string(),
  })
  .parse(process.env);

const db = drizzle({ connection: { url: env.DATABASE_URL }, schema });

const { resource } = crud(db);

const router = {
  notes: resource(schema.note, {
    searchFields: ["title", "content"],
    softDelete: {
      field: "deletedAt",
      deletedValue: () => new Date(),
    },
  }),
};

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

const spec = await generator.generate(router, {
  info: {
    title: "orpc-resource API",
    version: "1.0.0",
  },
});

const server = Bun.serve({
  routes: {
    "/": front,
    "/openapi.json": new Response(JSON.stringify(spec), {
      headers: { "Content-Type": "application/json" },
    }),
  },
  async fetch(req) {
    const { matched, response } = await handler.handle(req, {
      prefix: "/rpc",
    });
    if (matched) {
      return response;
    }
    return new Response("Not Found", { status: 404 });
  },
  development: true,
});

console.log(`Server running at ${server.url}`);

export type Router = typeof router;
