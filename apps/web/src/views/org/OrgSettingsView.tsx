'use client'
import { useState } from 'react'

import { useForm } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'

import { Button, Card, Form, Separator, Tabs, TextField } from '@vhyxui/react'

import { Typography } from '@/components/vhyxui-shims'
import { useOrgDetail, useRenameOrg } from '@/api/application/hooks/useOrg'

// import { usePermissions } from '@/application/hooks/usePermissions'
import { RoleLevel } from '@/api/domain/identity/enums/role.enum'
import { InvitationsTab } from './InvitationsTab'
import { RequireRole } from '@/api/domain/identity/guard/RequireRole'
import { MembersTable } from '../members/MembersTable'

const renameSchema = yup.object({
  name: yup.string().min(2).max(64).required('Name is required')
})

type Props = { accountId: string }

export default function OrgSettingsView({ accountId }: Props) {
  const [tab, setTab] = useState('members')
  const { data: org } = useOrgDetail(accountId)

  //   const permissions = usePermissions(accountId)
  const renameOrg = useRenameOrg(accountId)

  const form = useForm({
    resolver: yupResolver(renameSchema),
    values: { name: org?.name ?? '' }
  })

  // See decision.md, 2026-09-10, "Step 4: Form/Field error-display requires
  // reading formState.isSubmitting" (and its follow-up correction) — also
  // read `errors` so this re-renders on live onChange revalidation, not
  // just isSubmitting transitions.
  void form.formState.errors

  // See decision.md, 2026-09-10, "VhyxUI Form generic typing friction" —
  // reused verbatim from the Step 2 template.
  const untypedForm = form as any
  const handleFormSubmit = (data: any) => renameOrg.mutate(data)

  return (
    <div className='flex flex-col gap-6'>
      {/* ── Org header card ── */}
      <Card>
        <div className='flex flex-col gap-4'>
          <div>
            <Typography variant='h5'>{org?.name ?? '—'}</Typography>
            <Typography variant='body2'>
              {org?.stats.memberCount ?? 0} members · {org?.stats.activeApiKeys ?? 0} active API keys
            </Typography>
          </div>

          <Separator />

          {/* Rename — ADMIN+ only */}
          <RequireRole accountId={accountId} minLevel={RoleLevel.ADMIN}>
            <Typography variant='subtitle2'>Rename organization</Typography>
            <Form form={untypedForm} onSubmit={handleFormSubmit} className='flex gap-2 items-end'>
              <TextField label='Organization name' {...form.register('name')} />
              {/* Reading formState.isSubmitting here is what makes VhyxUI's
                  Form/Field error display refresh after a failed validation
                  — see decision.md, 2026-09-10, "Step 4: Form/Field error-
                  display requires reading formState.isSubmitting". */}
              <Button type='submit' loading={form.formState.isSubmitting || renameOrg.isPending}>
                Save
              </Button>
            </Form>
          </RequireRole>
        </div>
      </Card>

      {/* ── Tabs ──
          Members/Invitations tab CONTENT is left fully MUI-internal — both
          are real GenericServerTable-based list/CRUD screens, not "simple
          content page" material, and are explicitly Step 5's scope per
          decision.md's migration sequencing. Only the Tabs shell itself is
          migrated here. See decision.md, 2026-09-10, "Step 4 scope
          correction". */}
      <Card>
        <Tabs value={tab} onValueChange={setTab}>
          <Tabs.List>
            <Tabs.Trigger value='members'>Members</Tabs.Trigger>
            <Tabs.Trigger value='invitations'>Invitations</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value='members'>
            <MembersTable accountId={accountId} />
          </Tabs.Content>

          <Tabs.Content value='invitations'>
            <RequireRole
              accountId={accountId}
              minLevel={RoleLevel.ADMIN}
              fallback={
                <div className='p-6'>
                  <Typography variant='body2'>Only admins and owners can view invitations.</Typography>
                </div>
              }
            >
              <InvitationsTab accountId={accountId} />
            </RequireRole>
          </Tabs.Content>
        </Tabs>
      </Card>
    </div>
  )
}
