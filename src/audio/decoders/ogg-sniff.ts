import { open } from 'node:fs/promises'

export type OggCodec = 'vorbis' | 'opus'

/**
 * An Ogg container can hold Vorbis or Opus; the `.ogg`/`.opus`/`.oga` extension
 * alone doesn't say which. The first Ogg page's payload starts with a
 * codec-identification header: `\x01vorbis` or `OpusHead`. Reading that page
 * is cheap (a few KB at most), well short of decoding the file.
 */
export async function sniffOggCodec(filePath: string): Promise<OggCodec | null> {
  const handle = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(8192)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const bytes = head.subarray(0, bytesRead)
    if (bytes.toString('ascii', 0, 4) !== 'OggS')
      return null
    if (bytes.includes('OpusHead'))
      return 'opus'
    if (bytes.includes('vorbis'))
      return 'vorbis'
    return null
  }
  catch {
    return null
  }
  finally {
    await handle.close()
  }
}
