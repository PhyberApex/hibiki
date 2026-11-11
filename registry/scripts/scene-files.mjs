import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * Every `.json` file under `dir`, recursively. Symlinks are neither files nor
 * directories to a `Dirent`, so a PR cannot point an entry outside the tree.
 */
export function collectJsonFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(full))
    }
    else if (entry.isFile() && extname(entry.name) === '.json') {
      files.push(full)
    }
  }
  return files
}
