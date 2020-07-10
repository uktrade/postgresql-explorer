import * as path from 'path';
import * as theia from '@theia/plugin';
import { INode } from "./INode";
import { IColumn } from "./IColumn";

export class ColumnNode implements INode {

  constructor(private readonly column: IColumn) { }

  public async getChildren(): Promise<INode[]> { return []; }
  public getTreeItem(): theia.TreeItem {
    let icon = 'column';
    let label = `${this.column.column_name} : ${this.column.data_type}`;
    let tooltip = label;

    if (this.column.primary_key) icon = 'p-key';
    if (this.column.foreign_key) {
      icon = 'f-key';
      tooltip += '\n' + this.column.foreign_key.constraint;
      tooltip += ' -> ' + this.column.foreign_key.table + '.' + this.column.foreign_key.column;
    }

    return {
      label,
      tooltip,
      collapsibleState: theia.TreeItemCollapsibleState.None,
      contextValue: 'theia-postgres.tree.column',
      iconPath: {
        light: `/hostedPlugin/dit_theia_postgres/resources/light/${icon}.svg`,
        dark: `/hostedPlugin/dit_theia_postgres/resources/dark/${icon}.svg`
      }
    };
  }
}