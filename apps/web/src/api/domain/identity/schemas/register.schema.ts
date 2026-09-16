import * as yup from 'yup'

// export const registerSchema = yup.object({
//   firstName: yup.string().optional(),
//   lastName: yup.string().optional(),
//   email: yup.string().email('Enter a valid email').required('Email is required'),
//   password: yup.string().min(8, 'Password must be at least 8 characters').required('Password is required'),
//   confirmPassword: yup
//     .string()
//     .oneOf([yup.ref('password')], 'Passwords do not match')
//     .required('Please confirm your password')
// })

export const registerSchema = yup.object({
  firstName: yup.string().default(''),
  lastName: yup.string().default(''),
  email: yup.string().email('Enter a valid email').required('Email is required'),
  password: yup.string().min(8, 'Password must be at least 8 characters').required('Password is required'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'Passwords do not match')
    .required('Please confirm your password')
})

export type RegisterFormValues = yup.InferType<typeof registerSchema>
