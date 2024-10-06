import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TableNode } from "../tree";
import { Client } from 'pg';


export function getSelectTopCommand(runQueryAndDisplayResults: any) {
  return async function run(treeNode: TableNode) {
    const countInput = await vscode.window.showInputBox({ prompt: "Select how many?", placeHolder: "limit" });
    if (!countInput) return;

    const count: number = parseInt(countInput);
    if (Number.isNaN(count)) {
      vscode.window.showErrorMessage('Invalid quantity for selection - should be a number');
      return;
    }

    const quotedSchema = Client.prototype.escapeIdentifier(treeNode.schema);
    const quotedTable = Client.prototype.escapeIdentifier(treeNode.table);
    const quoted = `${quotedSchema}.${quotedTable}`;
    const sql = `SELECT * FROM ${quoted} LIMIT ${count};`

    var index = 1;
    const getPath = () => `/home/vscode/untitled-${index}.sql`
    while (fs.existsSync(getPath())) {
      ++index;
    }
    fs.writeFileSync(getPath(), sql, 'utf8');

    const textDocument = await vscode.workspace.openTextDocument(getPath());
    await vscode.window.showTextDocument(textDocument);

    const title = path.basename(textDocument.fileName);
    return runQueryAndDisplayResults(sql, textDocument.uri, title);
  }
}
