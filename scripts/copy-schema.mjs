import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src", "storage", "schema.sql");
const target = join(root, "dist", "storage", "schema.sql");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
