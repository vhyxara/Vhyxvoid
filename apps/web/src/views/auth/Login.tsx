'use client'

import { useRouter, useSearchParams } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Alert, Button, Form, TextField, toast } from '@vhyxui/react'

import Link from '@/libs/components/Link'

import { loginSchema, type LoginFormValues } from '@/api/domain/identity/schemas/login.schema'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'
import { authService } from '@/api/infrastructure/services/auth.service'
import { AUTH_ART, AuthShell } from './AuthShell'
import styles from './AuthShell.module.css'

// Where a sign-in may send people afterwards: a path on this site only.
const safeRedirect = (to: string | null) => (to && to.startsWith('/') && !to.startsWith('//') ? to : '/dashboard')

const Login = () => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { setTokens } = useAuthStore()

  const form = useForm<LoginFormValues>({
    resolver: yupResolver(loginSchema),
    defaultValues: { email: '', password: '' }
  })

  // Auth pages sit outside the dashboard providers: authService directly,
  // the tokens into the store, and a routing flag for the proxy.
  const onSubmit = async ({ email, password }: LoginFormValues) => {
    try {
      setTokens(await authService.login({ email, password }))

      // Lightweight routing flag for the proxy, no sensitive data; as long as the refresh token (30 days).
      document.cookie = `is_authenticated=1; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Strict`
      router.replace(safeRedirect(searchParams.get('redirectTo')))
    } catch (err: any) {
      toast.danger(err?.message ?? 'Sign-in failed. Please try again.')
    }
  }

  // VhyxUI's <Form> is typed against its own react-hook-form copy: see
  // decision.md, 2026-09-10, "VhyxUI Form generic typing friction".
  const untypedForm = form as any

  // Reading `errors` re-renders on every validation change, so a fixed field's
  // old error doesn't stay on screen (decision.md, 2026-09-10, "Step 4").
  void form.formState.errors

  return (
    <AuthShell art={AUTH_ART.login}>
      <div>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.lead}>Sign in to manage your tunnels, keys and traffic.</p>
      </div>

      {searchParams.get('verified') === '1' && <Alert variant='success'>Your email is verified. Sign in to get started.</Alert>}

      <Form form={untypedForm} onSubmit={(data: any) => onSubmit(data as LoginFormValues)} className='flex flex-col gap-5'>
        <TextField label='Email' type='email' autoComplete='email' placeholder='you@company.com' autoFocus {...form.register('email')} />
        <TextField label='Password' type='password' autoComplete='current-password' {...form.register('password')} />
        <p className={styles.row} style={{ justifyContent: 'flex-end', marginBlock: '-0.5rem 0' }}>
          <Link href='/forgot-password'>Forgot password?</Link>
        </p>
        <Button type='submit' loading={form.formState.isSubmitting} style={{ width: '100%' }}>
          Sign in
        </Button>
      </Form>

      <p className={styles.row}>
        New here? <Link href='/register'>Create an account</Link>
      </p>
    </AuthShell>
  )
}

export default Login
