// Only one query key needed for auth — the current session

import { createQueryKeys } from '@vhyxvoid/api-kit'

// Mutations (login, register, etc.) don't need keys
export const authKeys = createQueryKeys('auth')
