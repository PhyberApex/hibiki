#!/usr/bin/env node
// Copy built web dashboard into bot's static serve dir (Nest serves from web-dist).
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
