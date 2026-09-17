'use client'

import { useEffect } from 'react'

import { useRouter } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Button, Card, Form, TextField, toast } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { adminLoginSchema, type AdminLoginFormValues } from '@/api/domain/auth/login.schema'
import { useAdminAuthStore } from '@/api/domain/auth/auth.store'
import { adminAuthService } from '@/api/infrastructure/auth.service'

// Modeled on apps/web's views/auth/Login.tsx template (RHF + yup + VhyxUI
// Form, the `untypedForm` cast and `void form.formState.errors` fix -- see
// that file and internal-tools/user-frontend/decision.md, 2026-09-10, for
// why both are needed), but stripped to exactly what the real admin login
// endpoint takes: email + password, no remember-me/social-login/illustration
// panel/register-link -- none of that exists for the admin app. Plain
// fetch via adminAuthService, no useMutation/QueryClient dependency -- this
// page sits outside the authenticated shell, same reasoning as apps/web's
// own auth pages.
const AdminLogin = () => {
  const router = useRouter()
  const isAuthenticated = useAdminAuthStore(s => s.isAuthenticated)
  const setSession = useAdminAuthStore(s => s.setSession)

  const form = useForm<AdminLoginFormValues>({
    resolver: yupResolver(adminLoginSchema),
    defaultValues: { email: '', password: '' }
  })

  // Already-logged-in admin visiting /login directly -- send them straight
  // to the dashboard rather than showing the form again.
  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard')
  }, [isAuthenticated, router])

  const onSubmit = async ({ email, password }: AdminLoginFormValues) => {
    try {
      const res = await adminAuthService.login({ email, password })

      setSession(res)
      router.replace('/dashboard')
    } catch (err: any) {
      toast.danger(err?.message ?? 'Login failed. Please try again.')
    }
  }

  // See apps/web's Login.tsx for the full explanation of both lines below --
  // VhyxUI's <Form> types `form` against its OWN separately-installed
  // react-hook-form (cross-repo `link:` duplicate-dependency friction), and
  // Field's error display only re-renders when some ancestor reads
  // `formState.errors` (not just `isSubmitting`).
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => onSubmit(data as AdminLoginFormValues)

  const loading = form.formState.isSubmitting

  void form.formState.errors

  return (
    <div className='flex items-center justify-center min-bs-screen p-6'>
      <Card className='is-full max-is-[420px] p-8'>
        <div className='flex flex-col gap-1 mbe-6'>
          <Typography variant='h4'>VhyxVoid Admin</Typography>
          <Typography variant='body1'>Sign in with your admin account</Typography>
        </div>

        <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-5'>
          <TextField label='Email' placeholder='admin@company.local' autoFocus {...form.register('email')} />

          <TextField label='Password' placeholder='············' type='password' {...form.register('password')} />

          <Button type='submit' loading={loading} style={{ width: '100%' }}>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  )
}

export default AdminLogin
