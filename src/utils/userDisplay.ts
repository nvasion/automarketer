/**
 * Derive display information from an email address when no explicit
 * profile data is available.
 *
 * Examples:
 *   "kellan.strong@ahead.com" → { firstName: "Kellan", lastName: "Strong",  fullName: "Kellan Strong", initial: "K" }
 *   "john_doe@example.com"   → { firstName: "John",   lastName: "Doe",     fullName: "John Doe",      initial: "J" }
 *   "alice@example.com"      → { firstName: "Alice",  lastName: "",        fullName: "Alice",         initial: "A" }
 *   ""                       → { firstName: "",       lastName: "",        fullName: "",              initial: "?" }
 */
export function parseUserDetailsFromEmail(email: string) {
  if (!email) {
    return { firstName: '', lastName: '', fullName: '', initial: '?' }
  }

  const atIndex = email.indexOf('@')
  const username = atIndex !== -1 ? email.slice(0, atIndex) : email

  const parts = username.split(/[._-]/).filter(Boolean)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

  const firstName = parts[0] ? cap(parts[0]) : ''
  const lastName = parts.length > 1 ? cap(parts[parts.length - 1]) : ''
  const fullName = [firstName, lastName].filter(Boolean).join(' ')
  const initial = firstName ? firstName.charAt(0).toUpperCase() : email.charAt(0).toUpperCase()

  return { firstName, lastName, fullName, initial }
}
