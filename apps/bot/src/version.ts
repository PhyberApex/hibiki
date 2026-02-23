import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Reads version from root package.json (monorepo root, updated by CI/CD). */
export function getVersion(): string {
  try {
    const rootPath = join(process.cwd(), '../../package.json')
    const pkg = JSON.parse(readFileSync(rootPath, 'utf-8')) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  }
  catch {
    try {
      const localPath = join(process.cwd(), 'package.json')
      const pkg = JSON.parse(readFileSync(localPath, 'utf-8')) as { version?: string }
      return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
    }
    catch {
      return '0.0.0'
    }
  }
}
