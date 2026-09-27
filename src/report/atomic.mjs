// Readers poll report.json / progress.json while we write them: write a sibling temp file, then rename over the target.
import fs from 'node:fs';

/** Write text to `file` atomically (temp file in the same dir, then rename). */
export function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Write `obj` as pretty JSON to `file` atomically. */
export function writeJsonAtomic(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2));
}
