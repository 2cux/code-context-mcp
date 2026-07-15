#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

function normalizeArchivePath(value) {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  return normalized.startsWith("package/") ? normalized.slice("package/".length) : normalized;
}

function parsePax(content) {
  const fields = {};
  let offset = 0;
  while (offset < content.length) {
    const space = content.indexOf(0x20, offset);
    if (space < 0) break;
    const length = Number(content.subarray(offset, space).toString("utf8"));
    if (!Number.isFinite(length) || length <= 0) break;
    const record = content.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) fields[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return fields;
}

export function readPackedFiles(tarballPath) {
  const tar = gunzipSync(readFileSync(tarballPath));
  const files = new Map();
  let offset = 0;
  let nextPax = {};

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const readString = (start, length) => header
      .subarray(start, start + length)
      .toString("utf8")
      .replace(/\0.*$/s, "")
      .trim();
    const name = readString(0, 100);
    const prefix = readString(345, 155);
    const size = Number.parseInt(readString(124, 12) || "0", 8);
    const type = String.fromCharCode(header[156] || 0);
    const contentStart = offset + 512;
    const content = tar.subarray(contentStart, contentStart + size);
    const archivePath = nextPax.path || [prefix, name].filter(Boolean).join("/");

    if (type === "x") {
      nextPax = parsePax(content);
    } else {
      if (type === "\0" || type === "0") {
        files.set(normalizeArchivePath(archivePath), Buffer.from(content));
      }
      nextPax = {};
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

function readDirectoryFiles(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else files.set(path.relative(root, absolute).replace(/\\/g, "/"), readFileSync(absolute));
    }
  };
  visit(root);
  return files;
}

function markdownTargets(markdown) {
  const targets = [];
  const visibleLines = [];
  let fenced = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) visibleLines.push(line);
  }

  const visible = visibleLines.join("\n");
  const inline = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\s*\)/g;
  for (const match of visible.matchAll(inline)) {
    targets.push(match[1].replace(/^<|>$/g, ""));
  }

  const reference = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm;
  for (const match of visible.matchAll(reference)) targets.push(match[1] || match[2]);
  return targets;
}

function isRelativeTarget(target) {
  return Boolean(target) &&
    !target.startsWith("#") &&
    !target.startsWith("/") &&
    !target.startsWith("//") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

export function findBrokenMarkdownLinks(files) {
  const available = new Set(files.keys());
  const failures = [];

  for (const [markdownPath, content] of files) {
    if (!/\.md$/i.test(markdownPath)) continue;
    for (const rawTarget of markdownTargets(content.toString("utf8"))) {
      if (!isRelativeTarget(rawTarget)) continue;
      const withoutSuffix = rawTarget.split("#", 1)[0].split("?", 1)[0];
      let decoded;
      try {
        decoded = decodeURIComponent(withoutSuffix);
      } catch {
        failures.push({ markdownPath, rawTarget, resolved: "invalid URL encoding" });
        continue;
      }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(markdownPath), decoded));
      const exists = available.has(resolved) ||
        available.has(`${resolved}/README.md`) ||
        [...available].some((candidate) => candidate.startsWith(`${resolved.replace(/\/$/, "")}/`));
      if (!exists) failures.push({ markdownPath, rawTarget, resolved });
    }
  }

  return failures;
}

function defaultTarballPath() {
  const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));
  const filename = `${packageJson.name.replace(/^@/, "").replace(/\//g, "-")}-${packageJson.version}.tgz`;
  return path.resolve(process.env.npm_config_pack_destination || ".", filename);
}

function run() {
  if (/^(1|true)$/i.test(process.env.npm_config_dry_run || "")) return;

  const directoryFlag = process.argv.indexOf("--directory");
  let source;
  let files;
  if (directoryFlag >= 0) {
    source = path.resolve(process.argv[directoryFlag + 1] || ".");
    files = readDirectoryFiles(source);
  } else {
    source = path.resolve(process.argv[2] || defaultTarballPath());
    if (!existsSync(source)) throw new Error(`Packed tarball not found: ${source}`);
    files = readPackedFiles(source);
  }

  const failures = findBrokenMarkdownLinks(files);
  if (failures.length > 0) {
    const details = failures
      .map(({ markdownPath, rawTarget, resolved }) => `- ${markdownPath}: ${rawTarget} -> ${resolved}`)
      .join("\n");
    throw new Error(`Broken relative Markdown links in ${source}:\n${details}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
