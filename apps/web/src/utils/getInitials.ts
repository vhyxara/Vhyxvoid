// Returns initials from string
// export const getInitials = (string: string) =>
//   string.split(/\s/).reduce((response, word) => (response += word.slice(0, 1)), '')

export function getInitials(input: { firstName?: string; lastName?: string; email?: string } | string): string {
  if (typeof input === 'string') {
    return input
      .split(/\s+/)
      .map(word => word[0])
      .join('')
      .toUpperCase()
  }

  const { firstName, lastName, email } = input

  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase()
  if (firstName) return firstName[0].toUpperCase()
  if (email) return email[0].toUpperCase()

  return '?'
}
