import { defineConfig } from "tsdown";

export default defineConfig({
  platform: "node",
  dts: true,
  inlineOnly: false,
});
