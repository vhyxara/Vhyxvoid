// The text of /.well-known/security.txt (RFC 9116), from the public settings.
export function securityTxt(settings: Record<string, unknown>, site: string, now = new Date()): string | null {
  const contact = String(settings['support.securityContact'] || settings['support.email'] || '').trim()

  if (!contact) return null
  const policy = String(settings['support.securityPolicyUrl'] || '').trim()
  // Expires is required; a year ahead, renewed on every request.
  const expires = new Date(now.getTime() + 365 * 86_400_000)

  expires.setUTCHours(0, 0, 0, 0)

  return [
    `Contact: ${contact.includes('@') && !contact.startsWith('http') ? `mailto:${contact}` : contact}`,
    `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
    'Preferred-Languages: en',
    `Canonical: ${site}/.well-known/security.txt`,
    ...(policy ? [`Policy: ${policy.startsWith('/') ? `${site}${policy}` : policy}`] : []),
    ''
  ].join('\n')
}
