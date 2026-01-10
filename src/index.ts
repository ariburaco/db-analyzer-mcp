#!/usr/bin/env bun
import { DbAnalyzerServer } from './server.ts';

async function main(): Promise<void> {
  const server = new DbAnalyzerServer();
  await server.start();
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
