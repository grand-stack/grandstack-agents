#!/usr/bin/env node
// Copyright (c) "Neo4j"
// Neo4j Sweden AB [http://neo4j.com]
// Dependency-free check that relative links and #anchors in this repo's markdown files resolve, and that embedded
// diagrams are sound: images have alt text, SVGs are self-contained, and each figure's numbered legend matches the
// callout numbers drawn in the SVG.
// Links into sibling repositories are checked only when those repositories sit beside this one (as they do for the website sync).
// Usage: node scripts/check-links.mjs   (run from the repo root; exits 1 on any broken link)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SKIP = new Set(["node_modules", "dist", ".git", "generated"]);

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? markdownFiles(full) : name.endsWith(".md") ? [full] : [];
  });
}

const slug = (heading) =>
  heading.trim().toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");

function anchors(file) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));
}

let broken = 0;

function checkImages(file, raw) {
  const lines = raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " ")).split("\n");
  lines.forEach((line, idx) => {
    for (const m of line.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
      const [, alt, target] = m;
      if (!alt.trim()) { console.error(`${file}:${idx + 1}: image ${target} has no alt text`); broken++; }
      if (/^https?:/.test(target) || !target.endsWith(".svg")) continue;
      const svgPath = resolve(dirname(file), target);
      if (!existsSync(svgPath)) continue; // reported by the link check
      const svg = readFileSync(svgPath, "utf8");
      for (const bad of ["<script", "<style", "<foreignObject", "xlink:href", 'href="http']) {
        if (svg.includes(bad)) { console.error(`${svgPath}: contains ${bad}`); broken++; }
      }
      if (!/viewBox="/.test(svg) || !/role="img"/.test(svg) || !/<title[ >]/.test(svg)) { console.error(`${svgPath}: needs viewBox, role="img" and a <title>`); broken++; }
      const drawn = new Set([...svg.matchAll(/<circle[^>]*fill="#0a6190"\/>\s*<text[^>]*>(\d+)<\/text>/g)].map((x) => Number(x[1])));
      const listed = new Set();
      let started = false;
      for (const next of lines.slice(idx + 1)) {
        const item = next.match(/^(\d+)\.\s/);
        if (item) { started = true; listed.add(Number(item[1])); }
        else if (started && next.trim() !== "") break;
        else if (!started && next.trim() !== "" && !next.startsWith("*") && !next.startsWith("[") && !next.startsWith("The figure")) break;
      }
      const missing = [...drawn].filter((n) => !listed.has(n));
      const extra = [...listed].filter((n) => !drawn.has(n));
      if (missing.length || extra.length) {
        console.error(`${file}:${idx + 1}: legend does not match ${target} (drawn but not explained: ${missing.join(",") || "none"}; explained but not drawn: ${extra.join(",") || "none"})`);
        broken++;
      }
    }
  });
}

for (const file of markdownFiles(".")) {
  const raw = readFileSync(file, "utf8");
  checkImages(file, raw);
  const text = raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, hash] = target.split("#");
    const dest = path ? resolve(dirname(file), path) : resolve(file);
    // A link into a sibling repository (../../other-repo/docs/x.md) can only be checked when that repository is beside this one.
    const outside = relative(resolve("."), dest).split(sep);
    if (outside[0] === ".." && outside[1] && !existsSync(resolve(".", "..", outside[1]))) continue;
    if (!existsSync(dest)) { console.error(`${file}: missing file ${target}`); broken++; continue; }
    if (hash && dest.endsWith(".md") && !anchors(dest).has(hash)) { console.error(`${file}: missing anchor ${target}`); broken++; }
  }
}
if (broken) { console.error(`${broken} broken link(s)`); process.exit(1); }
console.log("All relative markdown links resolve");
