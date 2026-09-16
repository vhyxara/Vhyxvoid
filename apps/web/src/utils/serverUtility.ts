'use server'
import { cookies } from 'next/headers'

// Corrected function to get the cookie by name
export const getCookies = (name: string) => {
  const cookieStore = cookies()
  const token = cookieStore.then(cookies => cookies.get(name)) // Use the 'name' parameter to get the specific cookie
  console.log('nextjs export token', token)
  return token
}
