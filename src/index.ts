#!/usr/bin/env node

/**
 * CodeContext MCP — Entry Point
 *
 * Starts the MCP server over stdio.
 * The CLI is available at ./cli/index.ts (run via `code-context`).
 */

import { startServer } from "./mcp/server.js";

startServer().catch((err) => {
  console.error("Failed to start CodeContext MCP server:", err);
  process.exit(1);
});
