import { createQueryKeys } from '@vhyx/api-kit'

import type { FetchParams } from '@/libs/table/GenericServerTable'

export const adminFeedbackKeys = createQueryKeys<FetchParams>('admin-feedback')
