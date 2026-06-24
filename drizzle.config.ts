import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./drizzle/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
});
