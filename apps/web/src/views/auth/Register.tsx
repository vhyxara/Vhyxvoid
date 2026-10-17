'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Button, Form, TextField, toast } from '@vhyxui/react'

import type { RegisterFormValues } from '@/api/domain/identity/schemas/register.schema'
import { registerSchema } from '@/api/domain/identity/schemas/register.schema'
import { authService } from '@/api/infrastructure/services/auth.service'
import { AUTH_ART, AuthShell } from './AuthShell'
import styles from './AuthShell.module.css'

const Register = () => {
  const router = useRouter()

  const form = useForm<RegisterFormValues>({
    resolver: yupResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' }
  })

  const onSubmit = async ({ email, password, firstName, lastName }: RegisterFormValues) => {
    try {
      const res = await authService.register({ firstName, lastName, email, password })

      if (res?.requiresVerification) {
        router.replace(`/verify-email-sent?email=${encodeURIComponent(email)}`)
      } else {
        toast.success('Account created. Sign in to get started.')
        router.replace('/login')
      }
    } catch (err: any) {
      toast.danger(err?.message ?? 'Registration failed. Please try again.')
    }
  }

  // See Login.tsx: VhyxUI's Form typing, and re-rendering on validation.
  const untypedForm = form as any

  void form.formState.errors

  return (
    <AuthShell art={AUTH_ART.register}>
      <div>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.lead}>Free to start. Your first tunnel is a minute away.</p>
      </div>

      <Form form={untypedForm} onSubmit={(data: any) => onSubmit(data as RegisterFormValues)} className='flex flex-col gap-5'>
        <div className='grid grid-cols-2 gap-4'>
          <TextField label='First name' autoComplete='given-name' autoFocus {...form.register('firstName')} />
          <TextField label='Last name' autoComplete='family-name' {...form.register('lastName')} />
        </div>
        <TextField label='Email' type='email' autoComplete='email' placeholder='you@company.com' {...form.register('email')} />
        <TextField label='Password' type='password' autoComplete='new-password' {...form.register('password')} />
        <TextField label='Confirm password' type='password' autoComplete='new-password' {...form.register('confirmPassword')} />
        <Button type='submit' loading={form.formState.isSubmitting} style={{ width: '100%' }}>
          Create account
        </Button>
        <p className={styles.fine}>
          By creating an account you agree to the <Link href='/terms'>Terms of Service</Link> and the <Link href='/privacy'>Privacy Policy</Link>.
        </p>
      </Form>

      <p className={styles.row}>
        Already have an account? <Link href='/login'>Sign in</Link>
      </p>
    </AuthShell>
  )
}

export default Register
