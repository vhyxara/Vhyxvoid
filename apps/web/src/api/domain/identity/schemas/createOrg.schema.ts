import * as yup from 'yup'

export const createOrgSchema = yup.object({
  name: yup
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(64, 'Name must be under 64 characters')
    .required('Organization name is required')
})

export type CreateOrgFormValues = yup.InferType<typeof createOrgSchema>
