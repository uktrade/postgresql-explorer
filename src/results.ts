import * as theia from '@theia/plugin';
import { randomBytes } from 'crypto';
import { Pool, QueryResult, FieldDef } from 'pg';
import * as Cursor from 'pg-cursor';

interface FieldInfo extends FieldDef {
  display_type: string;
  // tabulator needs data as a dict, which won't play well with multiple
  // columns of the same name. So we have a dict of indexes to fake an array
  index: string;
};

export interface QueryResults extends QueryResult {
  fields: FieldInfo[];
};

interface TypeResult {
  oid: number;
  typname: string;
  display_type: string;
};

interface TypeResults extends QueryResult {
  rows: TypeResult[];
}

interface Panels {
  [id: string]: PanelWithResult,
}

interface PanelWithResult {
  err: any,
  fullResults: QueryResults
}

export function getRunQueryAndDisplayResults(pool: Pool) {

  // The "save" button that appears with results is a bit faffy to maintain due to the order
  // that multiple panels fire their change events when tabbling between. And it's still not
  // perfect because it appears in too many places in the UI
  var numActive: number = 0;
  var activeResults: QueryResults = undefined;
  var getActiveResults = () => [activeResults];
  var panelResults: Panels = {};

  function createPanel(title: string, onDidDispose: () => void) {
    var isActive = false;
    const panelId = randomBytes(16).toString('hex');

    const panel = theia.window.createWebviewPanel(
      'theia-postgres.results',
      'Results: ' + title, {
      area: theia.WebviewPanelTargetArea.Bottom,
    }, {
      enableScripts: true
    });

    panelResults[panelId] = {
      err: null,
      fullResults: {
        fields: [],
        rows: [],
        command: null,
        rowCount: null,
        oid: null
      }
    }

    panel.onDidChangeViewState(({ webviewPanel }) => {
      var changed = webviewPanel.active !== isActive;
      if (!changed) return;

      isActive = webviewPanel.active;
      numActive = numActive + (webviewPanel.active ? 1 : -1);
      if (webviewPanel.active) {
        activeResults = panelResults[panelId].fullResults;
      }
      theia.commands.executeCommand('setContext', 'theiaPostgresResultFocus', numActive > 0);
    });

    panel.webview.onDidReceiveMessage(
      message => {
        if (panelResults[panelId].err) {
          postError(panel, panelResults[panelId].err);
        } else {
          postResults(panel, panelResults[panelId].fullResults, panelResults[panelId].fullResults, 0);
        }
      }
    );

    panel.webview.html = panelHtml(panelId);

    panel.onDidDispose(() => {
      onDidDispose();
      delete panelResults[panelId];
    });
    return { panelId, panel };
  }

  function recordError(panelId: string, panel: theia.WebviewPanel, err) {
    panelResults[panelId].err = err;
    postError(panel, err);
  }

  function postError(panel, err) {
    panel.webview.postMessage({
      'command': 'ERROR',
      'summary': err.message,
      'header': '',
      'results': ''
    });
  }

  function recordResults(panelId: string, panel: theia.WebviewPanel, results: QueryResults) {
    const previousRowsLength = panelResults[panelId].fullResults.rows.length;
    panelResults[panelId].fullResults = {
      ...results,
      rows: panelResults[panelId].fullResults.rows.concat(results.rows),
    };
    postResults(panel, panelResults[panelId].fullResults, results, previousRowsLength);
  }

  function postResults(panel: theia.WebviewPanel, fullResults: QueryResults, results: QueryResults, previousRowsLength) {
    panel.webview.postMessage({
      'command': fullResults.command,
      'summary': summaryHtml(fullResults),
      'results': results,
      'offset': previousRowsLength,
    });
  }

  theia.window.registerWebviewPanelSerializer('theia-postgres.results', new (class implements theia.WebviewPanelSerializer {
    async deserializeWebviewPanel(webviewPanel: theia.WebviewPanel, state: any) {
      webviewPanel.webview.html = (state.panelId in panelResults) ? panelHtml(state.panelId) : '<p>The query must be re-run to see its results</p>';
    }
  }));

  async function runQueryAndDisplayResults(sql: string, uri: theia.Uri, title: string) {
    // Results are streamed to the WebView using postMessage to append to its HTML. In addition
    // to seeing results sooner, it avoid memory issues since it seems like setting a panel HTML to
    // a very long string is not expected in a plugin
    //
    // The HTML itself is generated on the server

    const typeNamesQuery = 'select oid, format_type(oid, typtypmod) as display_type, typname from pg_type';
    try {
      var types: TypeResults = await pool.query(typeNamesQuery);
    } catch (err) {
      theia.window.showErrorMessage(err.message);
      return;
    }

    const client = await pool.connect();

    try {
      var cursor = client.query(new Cursor(sql, [], { text: sql, rowMode: 'array' }));
    } catch (err) {
      theia.window.showErrorMessage(err.message);
      return;
    }

    function onEnd() {
      cursor.close(() => {
        client.release();
      });
    }

    var disposed = false;
    const { panelId, panel } = createPanel(title, () => { disposed = true });

    function fetchRows() {
      cursor.read(5000, (err, rows) => {
        if (disposed) {
          onEnd();
          return
        }

        if (err) {
          recordError(panelId, panel, err);
          onEnd();
          return;
        }

        const results = {
          ...cursor._result,
          rows: rows.map((row) => {
            var obj = {};
            row.forEach((val, index) => {
              obj[index] = val;
            });
            return obj;
          }),
          fields: cursor._result.fields.map((field, index) => {
            const type = types.rows.find((t) => t.oid === field.dataTypeID);
            return {
              ...field,
              index: '' + index,
              display_type: type.display_type
            };
          })
        };
        recordResults(panelId, panel, results);

        if (rows.length) {
          setTimeout(() => {
            process.nextTick(fetchRows);
          }, 500);
        }
        else onEnd();
      });
    }

    fetchRows();
  }

  return { runQueryAndDisplayResults: runQueryAndDisplayResults, getActiveResults: getActiveResults };
}

export function panelHtml(panelId: string) {
  const nonce = randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta http-equiv="content-type" content="text/html;charset=UTF-8">
      <meta http-equiv="content-security-policy" content="default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'">
      <link href="/hostedPlugin/dit_theia_postgres/resources/tabulator_simple.css" rel="stylesheet">
      <script src="/hostedPlugin/dit_theia_postgres/resources/tabulator.min.js"></script>
      <style nonce="${nonce}">
        body,
        html {
          margin: 0;
          padding: 0;
          height: 100%;
        }
      </style>
    </head>
    <body class="vscode-body">
      <div id="results-table"></div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        var state = vscode.getState({panelId: "${panelId}"});
        if (state) {
          // If we have a state, request the server to re-send the data
          vscode.postMessage({
            command: 'restore',
          });
        } else {
          // If no state, save the state so it will be available to be restored
          vscode.setState({panelId: "${panelId}"});
        }

        var table;
        window.addEventListener('message', event => {
          const message = event.data;

          if (message.command == 'ERROR') {
            var tableEl = document.getElementById('results-table');
            tableEl.innerHTML = message.summary;
            tableEl.classList.add('error');
            return;
          }

          if (message.command == null || message.command == 'SELECT' || message.command == 'EXPLAIN') {
            if (!table) {
              table = new Tabulator("#results-table", {
                height: "100%",
                columns: [{formatter:"rownum", align:"right", width:40}].concat(message.results.fields.map((field) => {
                  return {title:field.name, field: field.index, headerSort:false};
                })),
                data: message.results.rows
              });
            } else {
              table.addData(message.results.rows);
            }
          }  
        });
      </script>
    </body>
  </html>`;
}

function summaryHtml(results: QueryResults): string {
  // command is only returned on the end of the query, and its null otherwise.
  switch (results.command) {
    case 'SELECT':
    case null:
      return getRowCountResult(results.rows.length, 'returned'); break;
    case 'UPDATE': return getRowCountResult(results.rowCount, 'updated'); break;
    case 'DELETE': return getRowCountResult(results.rowCount, 'deleted'); break;
    case 'INSERT': return getRowCountResult(results.rowCount, 'inserted'); break;
    case 'CREATE': return getRowCountResult(results.rowCount, 'created'); break;
    case 'EXPLAIN': return getRowCountResult(results.rows.length, 'in plan'); break;
    default:
      return JSON.stringify(results);
  }
}

function headerHtml(results: QueryResults) {
  return `<tr><th></th>` +
    results.fields.map((field) => {
      return `<th><div class="field-name">${field.name}</div><div class="field-type">${field.display_type}</div></th>`;
    }).join('') +
    `</tr>`;
}

function rowsHtml(result: QueryResults, offset: number): string {
  return result.rows.map((row, rowIndex) => {
    return `<tr><th>${offset + ++rowIndex}</th>` + result.fields.map((field, idx) => {
      const formatted = formatFieldValue(field, row[idx]);
      return `<td>${formatted ? formatted : ''}</td>`;
    }).join('') + `</tr>`;
  }).join('');
}

function getRowCountResult(rowCount: number, text: string): string {
  return `Rows ${text}: ${rowCount}`;
}

function formatFieldValue(field: FieldInfo, value: any): string | undefined {
  if (value === null) return `<i>null</i>`;
  if (typeof value === typeof undefined) return '';

  let canTruncate: boolean = false;
  switch (field.format) {
    case 'interval':
      value = formatInterval(value); break;
    case 'json':
    case 'jsonb':
    case 'point':
    case 'circle':
      value = JSON.stringify(value);
    case 'timestamptz': value = value.toJSON().toString(); break;
    case 'text': canTruncate = true; break;
    default:
      value = value.toString();
  }
  let formatted = htmlEntities(value);
  if (canTruncate) {
    if (formatted && formatted.length > 150)
      formatted = formatted.substring(0, 148) + '&hellip;';
  }
  return formatted;
}

function htmlEntities(str: string): string | undefined {
  if (typeof str !== 'string') return str;
  return str ? str.replace(/[\u00A0-\u9999<>\&"']/gim, (i) => `&#${i.charCodeAt(0)};`) : undefined;
}

function formatInterval(value: any): string {
  let keys: string[] = ['years', 'months', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'];
  let is_negative = false;
  for (let key of keys) {
    if (!value.hasOwnProperty(key))
      value[key] = 0;
    else if (value[key] < 0) {
      is_negative = true;
      value[key] = Math.abs(value[key]);
    }
  }

  return formatIntervalISO(value, is_negative);
}

function formatIntervalISO(value: any, is_negative: boolean): string {
  let iso = 'P';
  if (value.years) iso += value.years.toString() + 'Y';
  if (value.months) iso += value.months.toString() + 'M';
  if (value.days) iso += value.days.toString() + 'D';

  if (iso === 'P' || (value.hours || value.minutes || value.seconds))
    iso += 'T';

  if (value.hours) iso += value.hours.toString() + 'H';
  if (value.minutes) iso += value.minutes.toString() + 'M';

  if (!value.hasOwnProperty('seconds')) value.seconds = 0;
  if (value.milliseconds) value.seconds += (value.milliseconds / 1000);

  if (value.seconds) iso += value.seconds.toString() + 'S';
  if (iso === 'PT') iso += '0S';
  return (is_negative ? '-' : '') + iso;
}