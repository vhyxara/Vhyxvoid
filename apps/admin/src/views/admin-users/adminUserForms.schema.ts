import * as yup from 'yup'

import type { CreateAdminDTO, UpdateAdminProfileDTO } from '@/api/infrastructure/admin-user.service'

// createAdminSchema (apps/api admin.dto.ts): email (valid email), password
// (min 8, no other rule), firstName and lastName (plain z.string(), so the
// backend would accept ""; a blank name shows as an empty row in the list, so
// these require a real value). Verified live 2026-09-21: 201 on success, 409
// "Admin with this email already exists" on a duplicate, 400 with per-field
// `errors` for a short password / bad email.
//
// `confirmPassword` is client-only and never sent. It is here because an admin
// sets ANOTHER person's password and there is no admin password reset or change
// endpoint anywhere in apps/api (backlog.md), so a typo would lock them out
// with no recovery short of the database.
export const createAdminSchema = yup.object({
  firstName: yup.string().trim().required('First name is required'),
  lastName: yup.string().trim().required('Last name is required'),
  email: yup.string().trim().email('Enter a valid email address').required('Email is required'),
  password: yup.string().min(8, 'Password must be at least 8 characters').required('Password is required'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'Passwords do not match')
    .required('Confirm the password')
})

export type CreateAdminFormValues = yup.InferType<typeof createAdminSchema>

export function toCreateAdminPayload(values: CreateAdminFormValues): CreateAdminDTO {
  return {
    email: values.email.trim(),
    password: values.password,
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim()
  }
}

// updateAdminSchema (apps/api): firstName/lastName only. PUT /users/:id ignores
// a blank name and answers 200 anyway, so without these `required` rules an
// empty field would show a success toast for a change that never happened.
export const editAdminProfileSchema = yup.object({
  firstName: yup.string().trim().required('First name is required'),
  lastName: yup.string().trim().required('Last name is required')
})

export type EditAdminProfileFormValues = yup.InferType<typeof editAdminProfileSchema>

export function toUpdateProfilePayload(values: EditAdminProfileFormValues): UpdateAdminProfileDTO {
  return { firstName: values.firstName.trim(), lastName: values.lastName.trim() }
}
