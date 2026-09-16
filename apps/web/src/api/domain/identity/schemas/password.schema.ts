import * as yup from 'yup'

export const forgotPasswordSchema = yup.object({
  email: yup.string().email('Enter a valid email').required('Email is required')
})

export const resetPasswordSchema = yup.object({
  newPassword: yup.string().min(8, 'Password must be at least 8 characters').required('New password is required'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('newPassword')], 'Passwords do not match')
    .required('Please confirm your password')
})

export const changePasswordSchema = yup.object({
  currentPassword: yup.string().min(1, 'Current password is required').required('Current password is required'),
  newPassword: yup.string().min(8, 'Password must be at least 8 characters').required('New password is required'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('newPassword')], 'Passwords do not match')
    .required('Please confirm your password')
})

export type ForgotPasswordFormValues = yup.InferType<typeof forgotPasswordSchema>
export type ResetPasswordFormValues = yup.InferType<typeof resetPasswordSchema>
export type ChangePasswordFormValues = yup.InferType<typeof changePasswordSchema>
