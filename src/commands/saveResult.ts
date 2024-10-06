import * as fs from 'fs';
import * as vscode from 'vscode';
import { stringify } from 'csv-stringify';
import { QueryResults } from "../results";

interface SaveTableQuickPickItem extends vscode.QuickPickItem {
  readonly index: number;
}

export function getSaveResultCommand(getActiveResults: () => QueryResults[]) {
  return async function run(uri: vscode.Uri) {
    let results = getActiveResults();
    if (!results) {
      vscode.window.showWarningMessage('Unable to save data - dataset not found');
      return;
    }

    let resultIndex = 0;
    if (results.length > 1) {
      let tables: SaveTableQuickPickItem[] = [];
      for (let i = 1; i <= results.length; i++) {
        tables.push({
          label: 'Table ' + i.toString(),
          index: i - 1
        });
      }

      let selected = await vscode.window.showQuickPick(tables, {});
      if (!selected) return;
      resultIndex = selected.index;
    }

    if ((results[resultIndex].rowCount || 0) < 1) {
      vscode.window.showWarningMessage('Unable to save data - table has no data');
      return;
    }

    let formats = ['csv', 'json'];
    let selFormat = await vscode.window.showQuickPick(formats, {});
    if (!selFormat) return;

    let fileData: string = '';
    if (selFormat === 'json') {
      let data = transformResult(results[resultIndex]);
      fileData = JSON.stringify(data, null, 2);
    } else if (selFormat === 'csv') {
      let columns: any = {};
      results[resultIndex].fields.forEach(field => {
        columns[field.index] = field.name
      });

      fileData = await new Promise<string>((resolve) => {
        stringify(results[resultIndex].rows, {
          header: true,
          columns: columns,
          cast: {
            boolean: (value: boolean): string => {
              return value ? 'true' : 'false';
            }
          }
        }, (err, output: string) => {
          if (err) { resolve(''); return; }
          resolve(output);
        });
      });
    }

    var index = 1;
    const getPath = () => `/home/vscode/untitled-${index}.${selFormat}`
    while (fs.existsSync(getPath())) {
      ++index;
    }
    fs.writeFileSync(getPath(), fileData, 'utf8');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(getPath()));
  }
}

function transformResult(result: QueryResults) {
  let trxFunc = transformData.bind(null, result.fields);
  return result.rows.map(trxFunc);
}

function transformData(fields: Array<any>, row: Array<any>) {
  let newRow: { [key: string]: any; } = {};
  let fieldCounts: { [key: string]: number; } = {};
  fields.forEach((field, idx) => {
    if (fieldCounts.hasOwnProperty(field)) {
      fieldCounts[field.name]++;
      newRow[field.name + '_' + fieldCounts[field.name]] = row[idx];
    } else {
      fieldCounts[field.name] = 0;
      newRow[field.name] = row[idx];
    }
  });
  return newRow;
}