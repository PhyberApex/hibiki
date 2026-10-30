import { parseFile } from 'music-metadata'

/**
 * A sound file's duration in whole milliseconds, read from its header without
 * decoding (#695), or null when the format is unknown or the header carries
 * no usable duration.
 */
export async function readDurationMs(filePath: string): Promise<number | null> {
  const metadata = await parseFile(filePath, { skipCovers: true, skipPostHeaders: true })
  const seconds = metadata.format.duration
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0)
    return null
  return Math.round(seconds * 1000)
}
