#!/usr/bin/env node
/**
 * CLI: node cli.js me|teams|projects
 * Uses the same env secrets as the HTTP server. Never prints secret values.
 */

import {
  ConfigError,
  MaindeckApiError,
  getMe,
  listProjects,
  listTeams,
} from "./lib/maindeck.js";

const command = (process.argv[2] || "me").toLowerCase();

async function main() {
  let data;
  switch (command) {
    case "me":
      data = await getMe();
      break;
    case "teams":
      data = await listTeams();
      break;
    case "projects":
      data = await listProjects();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage: node cli.js [me|teams|projects]");
      process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(2);
  }
  if (err instanceof MaindeckApiError) {
    console.error(err.message);
    process.exit(3);
  }
  console.error(err?.message || err);
  process.exit(1);
});
