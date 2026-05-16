import ExcelJS from "exceljs";
import type { TabularCell, Document } from "@/lib/tauri";

export interface ColumnConfig {
  index: number;
  name: string;
  prompt: string;
  format?: string;
  tags?: string[];
}

function formatCellForExport(cell: TabularCell | undefined): string {
  if (!cell) return "";
  if (cell.status === "pending") return "";
  if (cell.status === "error") return "Error";
  const content = cell.content ?? "";
  // Strip citation markers §N§ and pill syntax [[...]]
  return content
    .replace(/§\d+§/g, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Tabular Review"
  );
}

export async function exportToExcel(params: {
  reviewTitle: string;
  columns: ColumnConfig[];
  documents: Document[];
  cells: TabularCell[];
}) {
  const { reviewTitle, columns, documents, cells } = params;

  const sortedCols = [...columns].sort((a, b) => a.index - b.index);
  const cellMap = new Map<string, TabularCell>();
  for (const c of cells) cellMap.set(`${c.documentId}:${c.columnIndex}`, c);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Review");

  ws.columns = [
    { header: "Document", width: 40 },
    ...sortedCols.map((c) => ({ header: c.name, width: 40 })),
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF0EFED" },
  };

  for (const doc of documents) {
    const row: string[] = [doc.filename];
    for (const col of sortedCols) {
      row.push(formatCellForExport(cellMap.get(`${doc.id}:${col.index}`)));
    }
    const excelRow = ws.addRow(row);
    excelRow.alignment = { vertical: "top", wrapText: true };
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(reviewTitle)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
