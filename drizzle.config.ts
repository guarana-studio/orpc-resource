import { defineConfig } from "drizzle-kit";
export default defineConfig({
  out: "./test/drizzle",
  schema: "./test/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
