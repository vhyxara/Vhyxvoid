import * as yup from 'yup'

// Matches apps/api's adminLoginSchema (admin.dto.ts) exactly: email +
// password (min 8), no extra fields.
export const adminLoginSchema = yup.object({
  email: yup.string().email('Enter a valid email').required('Email is required'),
  password: yup.string().min(8, 'Password must be at least 8 characters').required('Password is required')
})

export type AdminLoginFormValues = yup.InferType<typeof adminLoginSchema>
