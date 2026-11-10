import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * Guards the OpenAI-compatible Vision Base URL (#767). The GM's API key and the
 * analyzed image travel to this URL from the main process, so a pasted URL must
 * not be able to reach cloud metadata or the LAN, ship the key in cleartext, or
 * smuggle the real endpoint into a query string or fragment.
 *
 * Allowed: `https:` to a public host; `http:` only to loopback (`localhost`,
 * `127.0.0.0/8`, `::1`) or an mDNS `.local` host, so local servers such as
 * Ollama and LM Studio keep working. Loopback is accepted over `https:` too.
 */

export type LookupAddresses = (hostname: string) => Promise<{ address: string, family: number }[]>

/** Ranges a Base URL host may never be or resolve to (link-local covers cloud metadata at 169.254.169.254). */
const BLOCKED = new BlockList()
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4') // "this network", 0.0.0.0 reaches loopback on most stacks
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4')
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4') // carrier-grade NAT
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4')
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4')
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4')
BLOCKED.addSubnet('224.0.0.0', 3, 'ipv4') // multicast and reserved
BLOCKED.addAddress('::', 'ipv6')
BLOCKED.addSubnet('fc00::', 7, 'ipv6') // unique local
BLOCKED.addSubnet('fe80::', 10, 'ipv6') // link-local
BLOCKED.addSubnet('ff00::', 8, 'ipv6') // multicast

const LOOPBACK = new BlockList()
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACK.addAddress('::1', 'ipv6')

/** `[::ffff:169.254.169.254]` must be judged as the IPv4 address it wraps. */
function unwrapMappedIpv4(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  return mapped ? mapped[1] : address
}

function ipFamily(address: string): 'ipv4' | 'ipv6' | null {
  const family = isIP(address)
  return family === 4
    ? 'ipv4'
    : family === 6
      ? 'ipv6'
      : null
}

function isLoopbackAddress(address: string): boolean {
  const ip = unwrapMappedIpv4(address)
  const family = ipFamily(ip)
  return family !== null && LOOPBACK.check(ip, family)
}

function isBlockedAddress(address: string): boolean {
  const ip = unwrapMappedIpv4(address)
  const family = ipFamily(ip)
  return family !== null && !LOOPBACK.check(ip, family) && BLOCKED.check(ip, family)
}

/** `URL.hostname` keeps IPv6 literals bracketed. */
function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || isLoopbackAddress(hostname)
}

function isMdnsHostname(hostname: string): boolean {
  return hostname.endsWith('.local')
}

/** What a log line or error may say about a Base URL: its origin, never path, query or userinfo. */
export function describeEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    return url.origin !== 'null'
      ? url.origin
      : url.protocol
  }
  catch {
    return 'an unparseable URL'
  }
}

/** The origin a stored key is bound to, or null when the Base URL does not parse. */
export function endpointOrigin(baseUrl: string): string | null {
  try {
    const origin = new URL(baseUrl).origin
    return origin !== 'null'
      ? origin
      : null
  }
  catch {
    return null
  }
}

/**
 * Throws a GM-readable error when `baseUrl` is not an acceptable Vision endpoint;
 * returns the parsed URL otherwise. Pure: hostnames are judged by name and
 * literal address here, and by what they resolve to in `assertEndpointResolvesSafely`.
 */
export function validateOpenAiBaseUrl(baseUrl: string): URL {
  let url: URL
  try {
    url = new URL(baseUrl)
  }
  catch {
    throw new Error('The Base URL is not a valid URL. Use something like https://api.openai.com/v1.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('The Base URL must start with https:// (or http:// for a server on this computer).')
  if (url.username || url.password)
    throw new Error('The Base URL must not contain a username or password. Put the API key in the API key field instead.')
  // `new URL('…?').search` is '' and `new URL('…#').hash` is '', so look at the raw string as well.
  if (url.search || baseUrl.includes('?'))
    throw new Error('The Base URL must not contain a query string (?…).')
  if (url.hash || baseUrl.includes('#'))
    throw new Error('The Base URL must not contain a fragment (#…).')

  const hostname = bareHostname(url)
  if (isBlockedAddress(hostname))
    throw new Error('The Base URL points at a private, link-local or reserved network address, which Hibiki does not allow.')
  if (url.protocol === 'http:' && !isLoopbackHostname(hostname) && !isMdnsHostname(hostname))
    throw new Error('The Base URL must use https://. Plain http:// is only allowed for a server on this computer (localhost) or a .local host, because the API key would travel unencrypted.')
  return url
}

const defaultLookup: LookupAddresses = hostname => lookup(hostname, { all: true, verbatim: true })

/**
 * Re-validates `baseUrl` and checks what its hostname resolves to right before a request,
 * so a public-looking name pointing at link-local or private space is refused. Loopback
 * names and `.local` hosts are exempt: they resolve to this machine or the LAN by design.
 * This narrows DNS rebinding (the name could change between lookup and connect) rather than closing it.
 */
export async function assertEndpointResolvesSafely(baseUrl: string, lookupImpl: LookupAddresses = defaultLookup): Promise<void> {
  const url = validateOpenAiBaseUrl(baseUrl)
  const hostname = bareHostname(url)
  if (ipFamily(hostname) !== null || isLoopbackHostname(hostname) || isMdnsHostname(hostname))
    return
  let addresses: { address: string }[]
  try {
    addresses = await lookupImpl(hostname)
  }
  catch {
    throw new Error(`Couldn't resolve the vision endpoint at ${describeEndpoint(baseUrl)}. Check the Base URL.`)
  }
  if (addresses.some(entry => isBlockedAddress(entry.address) || isLoopbackAddress(entry.address)))
    throw new Error(`The vision endpoint at ${describeEndpoint(baseUrl)} resolves to a private, loopback or link-local address, which Hibiki does not allow. Use localhost directly for a server on this computer.`)
}
