#!/usr/bin/env node
const { cp, mkdir, rm } = require('fs/promises');
const { join } = require('path');

async function main() {
  const webDist = join(__dirname, '..', 'apps', 'web', 'dist');
  const botPublic = join(__dirname, '..', 'apps', 'bot', 'web-dist');
  await rm(botPublic, { recursive: true, force: true }).catch(() => {});
  await mkdir(botPublic, { recursive: true });
  await cp(webDist, botPublic, { recursive: true });
}

main().catch((err) => {
  console.error('[copy-web-dist] failed:', err);
  process.exit(1);
});
