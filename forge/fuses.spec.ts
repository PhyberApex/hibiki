import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { fusesConfig } from './fuses'

describe('fusesConfig', () => {
  it('turns off every way to run arbitrary code through the packaged binary', () => {
    expect(fusesConfig[FuseV1Options.RunAsNode]).toBe(false)
    expect(fusesConfig[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
    expect(fusesConfig[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
  })

  it('only loads an integrity-checked app.asar', () => {
    expect(fusesConfig[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)
    expect(fusesConfig[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true)
  })

  it('encrypts Browser tab cookies at rest', () => {
    expect(fusesConfig[FuseV1Options.EnableCookieEncryption]).toBe(true)
  })

  it('sets every fuse @electron/fuses knows and asks packaging to reject an unset one', () => {
    expect(fusesConfig.version).toBe(FuseVersion.V1)
    expect(fusesConfig.strictlyRequireAllFuses).toBe(true)
    const fuseIndexes = Object.values(FuseV1Options).filter(v => typeof v === 'number')
    for (const index of fuseIndexes)
      expect(typeof fusesConfig[index as FuseV1Options]).toBe('boolean')
  })
})
