#!/usr/bin/env node
/**
 * The `sdcvalidator-ts` command. With no command, or with `mcp`, it starts the MCP stdio server: an
 * MCP registry client runs `npx sdcvalidator-ts mcp`.
 */
import { runStdio, SERVER_VERSION } from './mcp.js';

const [command] = process.argv.slice(2);

if (command === undefined || command === 'mcp') {
  if (command === undefined && process.stdin.isTTY) {
    process.stderr.write('sdcvalidator-ts: MCP server reading JSON-RPC 2.0 on stdin (--help for options, Ctrl-D to stop)\n');
  }
  await runStdio();
} else if (command === '--version' || command === '-v') {
  process.stdout.write(`${SERVER_VERSION}\n`);
} else {
  process.stdout.write(
    [
      'usage: sdcvalidator-ts [mcp | --version | --help]',
      '',
      'SDC4 validation in TypeScript, conforming to sdcvalidator.',
      'With no command, or with mcp, the MCP stdio server starts, reading JSON-RPC 2.0 on stdin.',
      '',
    ].join('\n'),
  );
}
