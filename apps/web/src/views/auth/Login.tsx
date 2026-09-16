'use client'

import { useEffect } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'

import { Button, Checkbox, Form, Separator, TextField, toast } from '@vhyxui/react'

import type { SystemMode } from '@core/types'
import { Typography } from '@/components/vhyxui-shims'
import Link from '@/libs/components/Link'
import Logo from '@/libs/layout/shared/Logo'
import themeConfig from '@configs/themeConfig'
import { useImageVariant } from '@core/hooks/useImageVariant'
import { useSettings } from '@core/hooks/useSettings'
import { AuthIllustrationPanel } from './AuthIllustrationPanel'

import { loginSchema, type LoginFormValues } from '@/api/domain/identity/schemas/login.schema'
import { useAuthStore } from '@/api/domain/identity/store/auth.store'

import { authService } from '@/api/infrastructure/services/auth.service'
import { getDisplayName } from '@/utils/utility'

// ── Component ─────────────────────────────────────────────────────────────

const Login = ({ mode }: { mode: SystemMode }) => {
  const darkImg = '/images/pages/auth-mask-dark.png'
  const lightImg = '/images/pages/auth-mask-light.png'
  const darkIllustration = '/images/illustrations/auth/v2-login-dark.png'
  const lightIllustration = '/images/illustrations/auth/v2-login-light.png'
  const borderedDarkIllustration = '/images/illustrations/auth/v2-login-dark-border.png'
  const borderedLightIllustration = '/images/illustrations/auth/v2-login-light-border.png'

  const searchParams = useSearchParams()
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

  const { setTokens } = useAuthStore()

  const form = useForm<LoginFormValues>({
    resolver: yupResolver(loginSchema),
    defaultValues: { email: '', password: '' }
  })

  // ── Plain fetch — no useMutation, no QueryClient dependency ──────────────
  // Auth pages sit outside the dashboard provider tree.
  // We call authService directly (it uses httpClientConfig / plain fetch)
  // and wire the result into Zustand + tokenRef manually.

  const onSubmit = async ({ email, password }: LoginFormValues) => {
    try {
      const res = await authService.login({ email, password })

      // Wire into Zustand (accessToken) and module ref (refreshToken)
      setTokens(res)

      // Lightweight routing flag for middleware — no sensitive data
      // Expires when the refresh token would expire (30 days)
      const maxAge = 60 * 60 * 24 * 30

      document.cookie = `is_authenticated=1; path=/; max-age=${maxAge}; SameSite=Strict`

      const redirectTo = searchParams.get('redirectTo') ?? '/dashboard'

      router.replace(redirectTo)
    } catch (err: any) {
      toast.danger(err?.message ?? 'Login failed. Please try again.')
    }
  }

  // VhyxUI's <Form> types `form` as UseFormReturn<FieldValues> from ITS OWN
  // separately-installed react-hook-form (VhyxUI is a separate repo/pnpm
  // workspace with its own node_modules — confirmed via tsc's error showing
  // two distinct react-hook-form type-declaration paths, one under this
  // repo's node_modules, one under VhyxUI's). This is the same class of
  // cross-repo duplicate-dependency issue as Step 0's dual-React-instance
  // finding, but as a compile-time nominal-type mismatch rather than a
  // runtime one — there's no single "correctly typed" cast target that
  // satisfies both copies' declarations simultaneously, so this uses `any`
  // rather than fighting phantom type identity. Flagged in decision.md,
  // 2026-09-10, "VhyxUI Form generic typing friction" — reuse this exact
  // pattern for every later form page rather than rediscovering it.
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => onSubmit(data as LoginFormValues)

  const user = useAuthStore(s => s.user)
  const loading = form.formState.isSubmitting

  // Also read `errors` (even though it's never used directly — Field reads
  // it via context on its own) so this component re-renders on every RHF
  // formState change, not just isSubmitting. Without this, a field that
  // revalidates clean while typing (RHF's default onChange reValidateMode)
  // leaves its OLD error message stuck on screen until the next submit.
  // See decision.md, 2026-09-10, "Step 4: VhyxUI Form/Field error display
  // requires reading a formState field that changes on submit".
  void form.formState.errors

  useEffect(() => {
    // Real user data from Zustand store — populated on login / bootstrap

    console.log('🚀 ~ file: UserDropdown.tsx:88 ~ user:', user)
    const displayName = getDisplayName(user?.firstName, user?.lastName, user?.email)

    console.log('🚀 ~ file: UserDropdown.tsx:90 ~ displayName:', displayName)
  }, [loading, user])

  return (
    <div className='flex bs-full justify-center'>
      {/* ── Left panel — illustration ── */}
      <AuthIllustrationPanel
        characterSrc={characterIllustration}
        characterAlt='character-illustration'
        maskSrc={authBackground}
        bordered={settings.skin === 'bordered'}
      />

      {/* ── Right panel — form ── */}
      <div className='flex justify-center items-center bs-full bg-backgroundPaper min-is-full! p-6 md:min-is-[unset]! md:p-12 md:is-[480px]'>
        <Link className='absolute block-start-5 sm:block-start-[33px] inline-start-6 sm:start-[38px]'>
          <Logo />
        </Link>

        <div className='flex flex-col gap-6 is-full sm:is-auto md:is-full sm:max-is-[400px] md:max-is-[unset] mbs-11 sm:mbs-14 md:mbs-0'>
          <div className='flex flex-col gap-1'>
            <Typography variant='h4'>{`Welcome to ${themeConfig.templateName}! 👋🏻`}</Typography>
            <Typography variant='body1'>Sign in to manage your tunnels, portals, and network activity.</Typography>
          </div>

          <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex flex-col gap-5'>
            <TextField
              label='Email'
              placeholder='Enter your email'
              autoFocus
              {...form.register('email')}
            />

            <TextField
              label='Password'
              placeholder='············'
              type='password'
              {...form.register('password')}
            />

            <div className='flex justify-between items-center gap-x-3 gap-y-1 flex-wrap'>
              <div className='flex items-center gap-2'>
                <Checkbox id='remember-me' />
                <label htmlFor='remember-me'>Remember me</label>
              </div>

              <Button asChild variant='link'>
                <Link href='/forgot-password'>Forgot password?</Link>
              </Button>
            </div>

            <Button type='submit' loading={loading} style={{ width: '100%' }}>
              Login
            </Button>

            <div className='flex justify-center items-center flex-wrap gap-2'>
              <Typography variant='body1'>New on our platform?</Typography>
              <Button asChild variant='link'>
                <Link href='/register'>Create an account</Link>
              </Button>
            </div>

            <Separator label='or' decorative={false} />

            <div className='flex justify-center items-center gap-1.5'>
              <Button iconOnly variant='ghost' aria-label='Sign in with Facebook' icon={<i className='tabler-brand-facebook-filled' />} />
              <Button iconOnly variant='ghost' aria-label='Sign in with Twitter' icon={<i className='tabler-brand-twitter-filled' />} />
              <Button iconOnly variant='ghost' aria-label='Sign in with GitHub' icon={<i className='tabler-brand-github-filled' />} />
              <Button iconOnly variant='ghost' aria-label='Sign in with Google' icon={<i className='tabler-brand-google-filled' />} />
            </div>
          </Form>
        </div>
      </div>
    </div>
  )
}

export default Login
