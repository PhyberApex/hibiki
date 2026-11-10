import { assertEndpointResolvesSafely, describeEndpoint, validateOpenAiBaseUrl } from './vision-endpoint'

describe('validateOpenAiBaseUrl', () => {
  it.each([
    'https://api.openai.com/v1',
    'https://openrouter.ai/api/v1',
    'http://localhost:11434/v1',
    'http://127.0.0.1:1234/v1',
    'http://[::1]:8080/v1',
    'http://ollama.localhost/v1',
    'http://gpu-box.local:11434/v1',
    'https://localhost:8443/v1',
  ])('accepts %s', (baseUrl) => {
    expect(() => validateOpenAiBaseUrl(baseUrl)).not.toThrow()
  })

  it.each([
    ['not a url', /not a valid URL/],
    ['file:///etc/passwd', /must start with https/],
    ['javascript:alert(1)', /must start with https/],
    ['ftp://example.com/v1', /must start with https/],
    ['https://api.openai.com@evil.test/v1', /username or password/],
    ['https://sk-secret@gateway.example/v1', /username or password/],
    ['https://evil.test/collect?x=', /query string/],
    ['https://evil.test/v1?', /query string/],
    ['https://api.openai.com/v1#', /fragment/],
    ['http://box.lan/v1', /must use https/],
    ['http://api.openai.com/v1', /must use https/],
    ['http://169.254.169.254/latest/meta-data', /private, link-local or reserved/],
    ['https://169.254.169.254/v1', /private, link-local or reserved/],
    ['https://10.0.0.5/v1', /private, link-local or reserved/],
    ['https://192.168.1.20/v1', /private, link-local or reserved/],
    ['https://172.20.0.1/v1', /private, link-local or reserved/],
    ['http://0.0.0.0:11434/v1', /private, link-local or reserved/],
    ['https://[fe80::1]/v1', /private, link-local or reserved/],
    ['https://[fd00::1]/v1', /private, link-local or reserved/],
    ['https://[::ffff:169.254.169.254]/v1', /private, link-local or reserved/],
  ])('rejects %s', (baseUrl, message) => {
    expect(() => validateOpenAiBaseUrl(baseUrl)).toThrow(message)
  })
})

describe('assertEndpointResolvesSafely', () => {
  it('resolves a public hostname and accepts public addresses', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '104.18.6.192', family: 4 },
    ])
    await expect(assertEndpointResolvesSafely('https://api.openai.com/v1', lookup)).resolves.toBeUndefined()
    expect(lookup).toHaveBeenCalledWith('api.openai.com')
  })

  it.each([
    '169.254.169.254',
    '10.1.2.3',
    '127.0.0.1',
    '::1',
    'fe80::1',
    '::ffff:192.168.0.1',
  ])('refuses a hostname resolving to %s', async (address) => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '104.18.6.192', family: 4 },
      {
        address,
        family: address.includes(':')
          ? 6
          : 4,
      },
    ])
    await expect(assertEndpointResolvesSafely('https://rebind.example/v1', lookup)).rejects.toThrow(/private, loopback or link-local/)
  })

  it('skips the lookup for loopback names, .local hosts and literal addresses', async () => {
    const lookup = jest.fn()
    await assertEndpointResolvesSafely('http://localhost:11434/v1', lookup)
    await assertEndpointResolvesSafely('http://gpu-box.local:11434/v1', lookup)
    await assertEndpointResolvesSafely('http://127.0.0.1:1234/v1', lookup)
    await assertEndpointResolvesSafely('https://8.8.8.8/v1', lookup)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('reports an unresolvable host by origin', async () => {
    const lookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertEndpointResolvesSafely('https://nope.example/secret/v1', lookup)).rejects.toThrow('Couldn\'t resolve the vision endpoint at https://nope.example.')
  })

  it('re-validates the URL before looking anything up', async () => {
    const lookup = jest.fn()
    await expect(assertEndpointResolvesSafely('https://evil.test/collect?x=', lookup)).rejects.toThrow(/query string/)
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('describeEndpoint', () => {
  it('keeps only the origin', () => {
    expect(describeEndpoint('https://sk-secret@gateway.example/v1/path?k=1')).toBe('https://gateway.example')
  })

  it('falls back to the scheme or a placeholder', () => {
    expect(describeEndpoint('file:///etc/passwd')).toBe('file:')
    expect(describeEndpoint('nope')).toBe('an unparseable URL')
  })
})
