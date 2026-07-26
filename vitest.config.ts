import { defineConfig } from "vitest/config";

// Unit tests only — the pure logic in src/lib that decides what the app tells a coach.
// Nothing here touches the Tauri bridge or the save parser, so no environment setup is
// needed: modules under test import their save types with `import type`, which the
// transform strips before anything tries to reach @tauri-apps.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
