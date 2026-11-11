import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8011",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    },
  },
  webServer: {
    command: "python3 -m http.server 8011 --bind 127.0.0.1 --directory ..",
    url: "http://127.0.0.1:8011/Samra-portfolio/index.html",
    reuseExistingServer: false,
  },
  reporter: "list",
});
