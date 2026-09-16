import * as yup from 'yup'

import { RoleLevel } from '@/api/domain/identity/enums/role.enum'

export const inviteSchema = yup.object({
  email: yup.string().email('Enter a valid email').required('Email is required'),
  roleLevel: yup.number().oneOf([RoleLevel.MEMBER, RoleLevel.ADMIN], 'Select a valid role').required('Role is required')
})

export type InviteFormValues = yup.InferType<typeof inviteSchema>
