'use client'

// Next Imports
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Third-party Imports
import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Button, Checkbox, Form, Separator, TextField, toast } from '@vhyxui/react'

import type { SystemMode } from '@core/types'
import { Typography } from '@/components/vhyxui-shims'

// Component Imports
import Logo from '@/libs/layout/shared/Logo'

// Hook Imports
import { useImageVariant } from '@core/hooks/useImageVariant'
import { useSettings } from '@core/hooks/useSettings'
import { AuthIllustrationPanel } from './AuthIllustrationPanel'
import type { RegisterFormValues } from '@/api/domain/identity/schemas/register.schema'
import { registerSchema } from '@/api/domain/identity/schemas/register.schema'

import { authService } from '@/api/infrastructure/services/auth.service'

// ── Component ─────────────────────────────────────────────────────────────

const Register = ({ mode }: { mode: SystemMode }) => {
  const darkImg = '/images/pages/auth-mask-dark.png'
  const lightImg = '/images/pages/auth-mask-light.png'
  const darkIllustration = '/images/illustrations/auth/v2-register-dark.png'
  const lightIllustration = '/images/illustrations/auth/v2-register-light.png'
  const borderedDarkIllustration = '/images/illustrations/auth/v2-register-dark-border.png'
  const borderedLightIllustration = '/images/illustrations/auth/v2-register-light-border.png'

  const router = useRouter()
  const { settings } = useSettings()

  const authBackground = useImageVariant(mode, lightImg, darkImg)

  const characterIllustration = useImageVariant(
    mode,
    lightIllustration,
    darkIllustration,
    borderedLightIllustration,
    borderedDarkIllustration
  )

  const form = useForm<RegisterFormValues>({
    resolver: yupResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' }
  })

  const onSubmit = async ({ email, password, firstName, lastName }: RegisterFormValues) => {
    try {
      const res = await authService.register({ firstName, lastName, email, password })

      console.log('Registration response:', res)

      if (res?.requiresVerification) {
        toast.success('Account created! Please check your email to verify your account.')
        router.replace(`/verify-email-sent?email=${encodeURIComponent(email)}`)
      } else {
        toast.success('Account created successfully!')
      }
    } catch (err: any) {
      toast.danger(err?.message ?? 'Registration failed. Please try again.')
    }
  }

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" —
  // reused verbatim from Login.tsx, the established template for this pattern.
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => onSubmit(data as RegisterFormValues)
  const loading = form.formState.isSubmitting

  // Also read `errors` (even though it's never used directly — Field reads
  // it via context on its own) so this component re-renders on every RHF
  // formState change, not just isSubmitting. Without this, a field that
  // revalidates clean while typing (RHF's default onChange reValidateMode)
  // leaves its OLD error message stuck on screen until the next submit.
  // See decision.md, 2026-09-10, "Step 4: VhyxUI Form/Field error display
  // requires reading a formState field that changes on submit".
  void form.formState.errors

  return (
    <div className='flex bs-full justify-center'>
      {/* ── Left panel ── */}
      <AuthIllustrationPanel
        characterSrc={characterIllustration}
        characterAlt='character-illustration'
        maskSrc={authBackground}
        bordered={settings.skin === 'bordered'}
        characterMaxHeight={600}
        maskMaxHeight={345}
      />

      {/* ── Right panel ── */}
      <div className='flex justify-center items-center bs-full bg-backgroundPaper min-is-full! p-6 md:min-is-[unset]! md:p-12 md:is-[480px]'>
        <Link href='/' className='absolute block-start-5 sm:block-start-[33px] inline-start-6 sm:start-[38px]'>
          <Logo />
        </Link>

        <div className='flex flex-col gap-6 is-full sm:is-auto md:is-full sm:max-is-[400px] md:max-is-[unset] mbs-11 sm:mbs-14 md:mbs-0'>
          <div className='flex flex-col gap-1'>
            <Typography variant='h4'>Create your account</Typography>
            <Typography variant='body2'>Get started — it only takes a minute</Typography>
          </div>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-5'>
            <div className='grid grid-cols-2 gap-4'>
              <TextField label='First name' autoFocus {...form.register('firstName')} />
              <TextField label='Last name' {...form.register('lastName')} />
            </div>

            <TextField label='Email' type='email' autoComplete='email' {...form.register('email')} />

            <TextField label='Password' type='password' autoComplete='new-password' {...form.register('password')} />

            <TextField
              label='Confirm password'
              type='password'
              autoComplete='new-password'
              {...form.register('confirmPassword')}
            />

            <div className='flex items-center gap-2'>
              <Checkbox id='agree-terms' />
              <label htmlFor='agree-terms'>
                I agree to{' '}
                <Link className='text-primary' href='/privacy'>
                  privacy policy &amp; terms
                </Link>
              </label>
            </div>

            <Button type='submit' loading={loading} style={{ width: '100%' }}>
              Create account
            </Button>

            <div className='flex justify-center items-center flex-wrap gap-2'>
              <Typography variant='body1'>Already have an account?</Typography>
              <Button asChild variant='link'>
                <Link href='/login'>Sign in instead</Link>
              </Button>
            </div>

            <Separator label='or' decorative={false} />

            <div className='flex justify-center items-center gap-1.5'>
              <Button iconOnly variant='ghost' aria-label='Sign up with Facebook' icon={<i className='tabler-brand-facebook-filled' />} />
              <Button iconOnly variant='ghost' aria-label='Sign up with Twitter' icon={<i className='tabler-brand-twitter-filled' />} />
              <Button iconOnly variant='ghost' aria-label='Sign up with GitHub' icon={<i className='tabler-brand-github-filled' />} />
              <Button iconOnly variant='ghost' aria-label='Sign up with Google' icon={<i className='tabler-brand-google-filled' />} />
            </div>
          </Form>
        </div>
      </div>
    </div>
  )
}

export default Register
