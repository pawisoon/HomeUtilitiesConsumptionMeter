#!/usr/bin/env node
/// Stamps public/index.html with a fresh ?v= on style.css and app.js so browsers
/// pick up new files after a deploy without a hard refresh. Run before deploy.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../public/index.html", import.meta.url);
const version = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM
const html = readFileSync(file, "utf8")
  .replace(/\/style\.css\?v=[^"]*/, `/style.css?v=${version}`)
  .replace(/\/app\.js\?v=[^"]*/, `/app.js?v=${version}`);
writeFileSync(file, html);
console.log(`stamped assets with v=${version}`);
