#!/usr/bin/env node
import { ConfigError, MaindeckApiError, apiGet, unwrapResources } from "./lib/maindeck.js";

const cmd = (process.argv[2] || "me").toLowerCase();

async function main() {
  if (cmd !== "me") {
    console.error("Usage: node cli.js me");
    process.exit(1);
  }
  const { body } = await apiGet("me");
  console.log(JSON.stringify(unwrapResources(body)[0] || body, null, 2));
}

main().catch((err) => {
  console.error(err instanceof ConfigError || err instanceof MaindeckApiError ? err.message : err);
  process.exit(1);
});
