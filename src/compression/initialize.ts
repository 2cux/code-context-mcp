/**
 * Shared compression runtime initialization.
 *
 * Every executable entry point must call this function before it can invoke
 * compression. Keeping the registration behind one entry point prevents the
 * CLI, MCP server, and unified context flow from drifting apart.
 */

import { registerAllStrategies } from "./registerStrategies.js";

export function initializeCompression(): void {
  registerAllStrategies();
}
