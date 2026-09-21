import { describe, expect, it } from 'vitest'

import {
  createAdminSchema,
  editAdminProfileSchema,
  toCreateAdminPayload,
  toUpdateProfilePayload
} from './adminUserForms.schema'

const valid = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@company.local',
  password: 'Sufficient1',
  confirmPassword: 'Sufficient1'
}

const errorsFor = async (schema: typeof createAdminSchema | typeof editAdminProfileSchema, values: object) => {
  try {
    await schema.validate(values, { abortEarly: false })

    return []
  } catch (err: any) {
    return err.inner.map((e: any) => `${e.path}: ${e.message}`) as string[]
  }
}

describe('createAdminSchema (mirrors apps/api createAdminSchema, plus client-only rules)', () => {
  it('accepts a complete, valid form', async () => {
    expect(await errorsFor(createAdminSchema, valid)).toEqual([])
  })

  it('rejects a password under 8 characters -- the backend answers 400 for it', async () => {
    expect(await errorsFor(createAdminSchema, { ...valid, password: 'short', confirmPassword: 'short' })).toContain(
      'password: Password must be at least 8 characters'
    )
  })

  it('accepts exactly 8 characters (backend is min(8), no other complexity rule)', async () => {
    expect(await errorsFor(createAdminSchema, { ...valid, password: 'abcdefgh', confirmPassword: 'abcdefgh' })).toEqual([])
  })

  it('rejects a confirmation that does not match, because an admin sets someone else\'s password and there is no reset', async () => {
    expect(await errorsFor(createAdminSchema, { ...valid, confirmPassword: 'Different1' })).toContain(
      'confirmPassword: Passwords do not match'
    )
  })

  it('rejects an invalid email', async () => {
    expect(await errorsFor(createAdminSchema, { ...valid, email: 'nope' })).toContain('email: Enter a valid email address')
  })

  it('requires both names, including whitespace-only (the backend would accept an empty string and store a blank name)', async () => {
    const errors = await errorsFor(createAdminSchema, { ...valid, firstName: '   ', lastName: '' })

    expect(errors).toContain('firstName: First name is required')
    expect(errors).toContain('lastName: Last name is required')
  })
})

describe('toCreateAdminPayload', () => {
  it('sends exactly the four fields the API takes -- never confirmPassword, never a role', () => {
    const payload = toCreateAdminPayload(valid)

    expect(Object.keys(payload).sort()).toEqual(['email', 'firstName', 'lastName', 'password'])
  })

  it('trims names and email but never the password', () => {
    expect(
      toCreateAdminPayload({ ...valid, firstName: ' Ada ', lastName: ' Lovelace ', email: ' ada@company.local ', password: ' pw with spaces ', confirmPassword: ' pw with spaces ' })
    ).toEqual({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@company.local', password: ' pw with spaces ' })
  })
})

describe('editAdminProfileSchema / toUpdateProfilePayload', () => {
  it('rejects a blank name: PUT /users/:id silently ignores one and still answers 200, so it must never be sent', async () => {
    const errors = await errorsFor(editAdminProfileSchema, { firstName: '', lastName: '  ' })

    expect(errors).toContain('firstName: First name is required')
    expect(errors).toContain('lastName: Last name is required')
  })

  it('sends only firstName and lastName, trimmed -- no email or password, which the route ignores', () => {
    expect(toUpdateProfilePayload({ firstName: ' Conrad ', lastName: 'Tracton ' })).toEqual({
      firstName: 'Conrad',
      lastName: 'Tracton'
    })
  })
})
