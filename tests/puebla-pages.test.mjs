import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

const workspace = new URL("../", import.meta.url);
const origin = "https://epicenterdsp.com";
const entries = ["/puebla2026/", "/puebla2026/?platform=android", "/puebla2026/?platform=ios", "/puebla2026/admin/"];

function fileFor(url) {
  const path = url.pathname.slice(1);
  return new URL(path.endsWith("/") || !path ? `${path}index.html` : path, workspace);
}

test("GitHub Pages can serve the existing root and both Puebla directories without a router", async () => {
  await access(new URL(".nojekyll", workspace));
  assert.equal((await readFile(new URL("CNAME", workspace), "utf8")).trim(), "epicenterdsp.com");
  for (const entry of ["/", "/links/", "/privacy/", "/terms/", "/support/", "/support/ios/", ...entries]) {
    assert.match(await readFile(fileFor(new URL(entry, origin)), "utf8"), /^<!doctype html>/i);
  }
});

test("Puebla pages resolve local links, assets and JS imports on direct navigation", async () => {
  const visited = new Set();
  async function verify(page) {
    const file = fileFor(page);
    if (visited.has(file.href)) return;
    visited.add(file.href);
    assert.ok((await stat(file)).isFile(), `${page.href} resolves to a file`);
    const isPage = entries.includes(page.pathname);
    if (!isPage && !/\.m?js$/.test(page.pathname)) return;
    const source = await readFile(file, "utf8");
    const references = isPage
      ? source.matchAll(/\b(?:src|href)="(?!#)([^"]+)"/g)
      : source.matchAll(/\b(?:from|import)\s+["']([^"']+)["']/g);
    for (const [, reference] of references) {
      const target = new URL(reference, page);
      if (target.origin === origin) await verify(target);
    }
  }
  for (const entry of entries) await verify(new URL(entry, origin));
});
