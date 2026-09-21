import type { ReactNode } from 'react'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { FormProvider, useFormContext } from 'react-hook-form'
import { ApiError } from '@vhyx/api-kit'

const create = vi.fn()
const update = vi.fn()
const push = vi.fn()
const toastSuccess = vi.fn()
const toastDanger = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/api/infrastructure/admin-user.service', () => ({
  adminUserService: { create: (...a: unknown[]) => create(...a), update: (...a: unknown[]) => update(...a) }
}))

// @vhyxui/react's components throw "Invalid hook call" under this repo's React
// instance (cross-repo `link:` duplication; see GenericServerTable.test.tsx), so
// they are stubbed with the smallest real-DOM equivalents. Form provides the RHF
// context and TextField reads its own error from it, matching what the real
// Field does, so validation messages are assertable.
vi.mock('@vhyxui/react', async () => {
  const { createContext, useContext } = await import('react')
  const OpenContext = createContext(false)

  const Dialog = Object.assign(
    ({ open, children }: { open?: boolean; children?: ReactNode }) => (
      <OpenContext.Provider value={!!open}>{children}</OpenContext.Provider>
    ),
    {
      Portal: ({ children }: { children?: ReactNode }) => (useContext(OpenContext) ? <div>{children}</div> : null),
      Overlay: () => null,
      Content: ({ children }: { children?: ReactNode }) => <div role='dialog'>{children}</div>,
      Title: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
      Footer: ({ children }: { children?: ReactNode }) => <div>{children}</div>
    }
  )

  return {
    Dialog,
    Alert: ({ children }: { children?: ReactNode }) => <div role='note'>{children}</div>,
    Card: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
    Button: ({ children, loading, iconOnly, icon, variant, size, ...rest }: any) => (
      <button {...rest} disabled={rest.disabled || loading}>
        {children}
      </button>
    ),
    Form: ({ form, onSubmit, children }: any) => (
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>{children}</form>
      </FormProvider>
    ),
    TextField: ({ label, name, ...rest }: any) => {
      const { formState } = useFormContext()
      const err = (formState.errors as any)[name]?.message

      return (
        <div>
          <label>
            {label}
            <input name={name} {...rest} />
          </label>
          {err && <span role='alert'>{err}</span>}
        </div>
      )
    },
    toast: { success: (m: string) => toastSuccess(m), danger: (m: string) => toastDanger(m) }
  }
})

vi.mock('@/components/vhyxui-shims', () => ({
  Typography: ({ children }: { children?: ReactNode }) => <p>{children}</p>
}))

import { CreateAdminDialog } from './CreateAdminDialog'
import { EditAdminProfileCard } from './EditAdminProfileCard'
import { useAdminAuthStore } from '@/api/domain/auth/auth.store'

function withClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

function fillValidCreateForm() {
  type('First name', 'Ada')
  type('Last name', 'Lovelace')
  type('Email', 'ada@company.local')
  type('Password', 'Sufficient1')
  type('Confirm password', 'Sufficient1')
}

beforeEach(() => {
  cleanup()
  ;[create, update, push, toastSuccess, toastDanger].forEach(m => m.mockReset())
})

describe('CreateAdminDialog', () => {
  it('renders nothing while closed', () => {
    withClient(<CreateAdminDialog open={false} onClose={() => {}} />)

    expect(screen.queryByText('Create admin')).toBeNull()
  })

  it('does not call the API when the form is invalid, and shows the field errors', async () => {
    withClient(<CreateAdminDialog open onClose={() => {}} />)
    // A malformed email never reaches react-hook-form: the real Form has no
    // noValidate, so the browser's own type='email' check blocks the submit first
    // (same as Register / Invite member). The schema's email rule is covered in
    // adminUserForms.schema.test.ts.
    type('Email', 'ada@company.local')
    type('Password', 'short')
    type('Confirm password', 'different')
    fireEvent.click(screen.getByRole('button', { name: 'Create admin' }))

    await waitFor(() => expect(screen.getByText('Password must be at least 8 characters')).toBeTruthy())
    expect(screen.getByText('First name is required')).toBeTruthy()
    expect(screen.getByText('Passwords do not match')).toBeTruthy()
    expect(create).not.toHaveBeenCalled()
  })

  it('posts exactly the four API fields (no confirmPassword, no role), then closes and opens the new admin so a role can be assigned', async () => {
    create.mockResolvedValue({ id: 'new-id', email: 'ada@company.local', fullName: 'Ada Lovelace' })
    const onClose = vi.fn()

    withClient(<CreateAdminDialog open onClose={onClose} />)
    fillValidCreateForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create admin' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      email: 'ada@company.local',
      password: 'Sufficient1',
      firstName: 'Ada',
      lastName: 'Lovelace'
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin-users/new-id'))
    expect(onClose).toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Ada Lovelace'))
  })

  it('puts a 409 duplicate-email error on the email field, keeps the dialog open, and does not navigate', async () => {
    create.mockRejectedValue(new ApiError(409, 'Admin with this email already exists'))
    const onClose = vi.fn()

    withClient(<CreateAdminDialog open onClose={onClose} />)
    fillValidCreateForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create admin' }))

    await waitFor(() => expect(screen.getByText('Admin with this email already exists')).toBeTruthy())
    expect(push).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(toastDanger).not.toHaveBeenCalled()
  })

  it('toasts any other failure instead of pinning it to a field', async () => {
    create.mockRejectedValue(new ApiError(403, "Forbidden: Missing ability 'admin.create'"))

    withClient(<CreateAdminDialog open onClose={() => {}} />)
    fillValidCreateForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create admin' }))

    await waitFor(() => expect(toastDanger).toHaveBeenCalledWith("Forbidden: Missing ability 'admin.create'"))
    expect(push).not.toHaveBeenCalled()
  })
})

const admin = {
  id: 'target',
  email: 'target@company.local',
  firstName: 'Con',
  lastName: 'Tract',
  fullName: 'Con Tract',
  isSuperAdmin: false,
  status: true,
  lastLoginAt: null,
  roles: []
}

describe('EditAdminProfileCard', () => {
  beforeEach(() => {
    useAdminAuthStore.setState({ admin: { id: 'me', email: 'me@c.co', fullName: 'Me', isSuperAdmin: true } })
  })

  it('starts with the current names, offers only name fields (no email or password), and keeps Save disabled until something changes', () => {
    withClient(<EditAdminProfileCard admin={admin} />)

    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Con')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('Tract')
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuses a blank name instead of sending it (the API would answer 200 and change nothing)', async () => {
    withClient(<EditAdminProfileCard admin={admin} />)
    type('First name', '   ')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.getByText('First name is required')).toBeTruthy())
    expect(update).not.toHaveBeenCalled()
  })

  it('sends trimmed names to PUT for this admin and confirms', async () => {
    update.mockResolvedValue({ ...admin, firstName: 'Conrad', fullName: 'Conrad Tract' })

    withClient(<EditAdminProfileCard admin={admin} />)
    type('First name', ' Conrad ')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith('target', { firstName: 'Conrad', lastName: 'Tract' }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Profile updated'))
  })

  it('toasts a server failure', async () => {
    update.mockRejectedValue(new ApiError(404, 'Admin not found'))

    withClient(<EditAdminProfileCard admin={admin} />)
    type('Last name', 'Other')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(toastDanger).toHaveBeenCalledWith('Admin not found'))
  })
})
