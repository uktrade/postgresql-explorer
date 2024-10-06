import * as vscode from 'vscode';
import { setupPostgresLanguageClient } from './language/client';
import { PostgreSQLTreeDataProvider } from './tree';
import { getRunQueryAndDisplayResults } from './results';

import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

import { getNewQueryCommand } from './commands/newQuery';
import { getRefreshCommand } from './commands/refresh';
import { getRunCommand } from './commands/runQuery';
import { getSaveResultCommand } from './commands/saveResult';
import { getSelectTopCommand } from './commands/selectTop';

export async function activate(context: vscode.ExtensionContext) {
  // node-postgresql almost supports all libpq environment variables, but
  // not the PGSSL* ones, presumably to be able to pass in certs and keys
  // as strings
  const pgSSLMode = process.env.PGSSLMODE || 'verify-full';
  const pool = new Pool({
    ssl: pgSSLMode == 'disable' ? false : {
      rejectUnauthorized: ['verify-ca', 'verify-full'].includes(pgSSLMode),
      ca: process.env.PGSSLROOTCERT ? readFileSync(process.env.PGSSLROOTCERT).toString() : undefined,
      key: process.env.PGSSLKEY ? readFileSync(process.env.PGSSLKEY).toString() : undefined,
      cert: process.env.PGSSLCERT ? readFileSync(process.env.PGSSLCERT).toString() : undefined,
    }
  });

  const tree = new PostgreSQLTreeDataProvider(pool);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('postgres', tree));

  const { runQueryAndDisplayResults, getActiveResults } = getRunQueryAndDisplayResults(pool);
  context.subscriptions.push(vscode.commands.registerCommand('posgresql-explorer.newQuery', getNewQueryCommand()));
  context.subscriptions.push(vscode.commands.registerCommand('posgresql-explorer.refresh', getRefreshCommand(tree)));
  context.subscriptions.push(vscode.commands.registerCommand('posgresql-explorer.runQuery', getRunCommand(runQueryAndDisplayResults)));
  context.subscriptions.push(vscode.commands.registerCommand('posgresql-explorer.saveResult', getSaveResultCommand(getActiveResults)));
  context.subscriptions.push(vscode.commands.registerCommand('posgresql-explorer.selectTop', getSelectTopCommand(runQueryAndDisplayResults)));

  await setupPostgresLanguageClient(context);
}

export function deactivate() {
}
