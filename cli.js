#!/usr/bin/env node
/**
 * CLI: node cli.js <command>
 * Commands: me | teams | projects | work-orders <projectId>
 */

import {
  ConfigError,
  MaindeckApiError,
  getMe,
  listAllProjects,
  listProjectWorkOrders,
  listTeams,
} from "./lib/maindeck.js";

const command = (process.argv[2] || "me").toLowerCase();
const arg = process.argv[3];

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
      data = await listAllProjects();
      break;
    case "work-orders":
    case "jobs":
      if (!arg) {
        console.error("Usage: node cli.js work-orders <projectId>");
        process.exit(1);
      }
      data = await listProjectWorkOrders(arg);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error("Usage: node cli.js [me|teams|projects|work-orders <projectId>]");
      process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  if (err instanceof ConfigError || err instanceof MaindeckApiError) {
    console.error(err.message);
    process.exit(err instanceof ConfigError ? 2 : 3);
  }
  console.error(err?.message || err);
  process.exit(1);
});
