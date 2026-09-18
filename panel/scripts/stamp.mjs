#!/usr/bin/env node
/// Stamps every local asset in public/index.html with a fresh ?v= so browsers
/// pick up new files after a deploy without a hard refresh. Run before deploy.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../public/index.html", import.meta.url);
const version = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM

// Matches href="/style.css?v=…" and src="/app.js?v=…", leaving CDN URLs alone.
const html = readFileSync(file, "utf8").replace(
  /(?<=["'])\/([\w./-]+\.(?:css|js))\?v=[^"']*/g,
  `/$1?v=${version}`,
);
writeFileSync(file, html);

const stamped = [...html.matchAll(/\/([\w./-]+\.(?:css|js))\?v=([^"']*)/g)];
if (stamped.some(([, , v]) => v !== version)) {
  throw new Error("some assets kept an old version query");
}
console.log(`stamped ${stamped.length} assets with v=${version}`);
