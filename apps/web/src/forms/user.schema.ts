import * as yup from 'yup'

export const roleSchema = yup.object({
  name: yup
    .string()
    .required('Role name is required')
    .min(3, 'Role name must be at least 3 characters')
    .max(50, 'Role name must not exceed 50 characters'),

  description: yup.string().required('Description is required').min(5, 'Description must be at least 5 characters'),

  abilityIds: yup.array().of(yup.string())

  // abilityIds: yup.array().of(yup.string()).min(1, 'Select at least one permission')
})
