export function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 毫秒 → "00:12" */
export function clock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

/** 毫秒 → "1M 42S" */
export function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}M ${seconds % 60}S` : `${seconds}S`;
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export type DiffLine = {
  kind: "add" | "remove" | "neutral";
  number?: number;
  text: string;
};

/** 解析 unified diff，行号：新增/上下文行用新文件行号，删除行用旧文件行号 */
export function parseDiff(diff: string) {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.replace(/\n$/, "").split("\n")) {
    if (raw.startsWith("---") || raw.startsWith("+++")) continue;

    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }

    if (raw.startsWith("+")) {
      lines.push({ kind: "add", number: newLine++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      lines.push({ kind: "remove", number: oldLine++, text: raw.slice(1) });
    } else {
      lines.push({ kind: "neutral", number: newLine++, text: raw.slice(1) });
      oldLine++;
    }
  }

  return {
    lines,
    additions: lines.filter((line) => line.kind === "add").length,
    deletions: lines.filter((line) => line.kind === "remove").length,
  };
}
