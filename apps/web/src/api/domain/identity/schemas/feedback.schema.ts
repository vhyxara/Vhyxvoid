// utils/feedback.schema.ts — use with react-hook-form + yup
import * as yup from 'yup'

import type { FeedbackType } from '@/api/domain/feedback/feedback.types'

export const feedbackSchema = yup.object({
  type: yup
    .mixed<FeedbackType>()
    .oneOf(['BUG_REPORT', 'FEATURE_REQUEST', 'GENERAL_FEEDBACK', 'UI_ISSUE'] satisfies FeedbackType[])
    .required('Please select a feedback type'),

  title: yup.string().min(3, 'At least 3 characters').max(150, 'Max 150 characters').required('Title is required'),

  description: yup
    .string()
    .min(10, 'At least 10 characters')
    .max(5000, 'Max 5000 characters')
    .required('Description is required'),

  stepsToReproduce: yup.string().max(3000).nullable().default(null),
  expectedBehavior: yup.string().max(1000).nullable().default(null),
  actualBehavior: yup.string().max(1000).nullable().default(null)
})

export type FeedbackFormValues = yup.InferType<typeof feedbackSchema>
