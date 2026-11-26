import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingsForm } from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { handleServerError } from '@/lib/handle-server-error'

import {
  saveTicketSettings,
  ticketSettingsQuery,
  type TicketSettings,
} from './api'

export function TicketSettingsForm({ inline = false }: { inline?: boolean }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const query = useQuery(ticketSettingsQuery)
  const [changes, setChanges] = useState<Partial<TicketSettings>>({})
  const save = useMutation({
    mutationFn: saveTicketSettings,
    onError: (error) => handleServerError(error),
    onSuccess: (settings) => {
      client.setQueryData(ticketSettingsQuery.queryKey, settings)
      setChanges({})
      toast.success(t('Settings saved'))
    },
  })
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  if (!query.data) return <LoadingState />
  const values = { ...query.data, ...changes }
  const submit = () => save.mutate(values)
  const unchanged =
    values.name === query.data.name && values.enabled === query.data.enabled
  return (
    <SettingsSection title={t('Support tickets')}>
      <SettingsForm
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Field>
          <FieldLabel htmlFor='tickets-enabled'>
            {t('Enable support tickets')}
          </FieldLabel>
          <Switch
            id='tickets-enabled'
            disabled={save.isPending}
            checked={values.enabled}
            onCheckedChange={(enabled) => setChanges({ ...changes, enabled })}
          />
          <FieldDescription>
            {t(
              'Show the ticket menu to signed-in users. Turning it off hides the menu without deleting conversations.'
            )}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='ticket-menu-name'>
            {t('Ticket menu name')}
          </FieldLabel>
          <Input
            id='ticket-menu-name'
            disabled={save.isPending}
            value={values.name}
            maxLength={80}
            placeholder={t('Support tickets')}
            onChange={(event) =>
              setChanges({ ...changes, name: event.target.value })
            }
          />
          <FieldDescription>
            {t(
              'Used in the sidebar and page heading. Leave blank to use the default name.'
            )}
          </FieldDescription>
        </Field>
        <p className='text-muted-foreground text-sm'>
          {t(
            'New tickets and user replies notify the WeChat recipient configured under Community chat when the bot is enabled.'
          )}
        </p>
        {inline ? (
          <Button type='submit' disabled={save.isPending || unchanged}>
            {t('Save')}
          </Button>
        ) : (
          <SettingsPageFormActions
            onSave={submit}
            isSaving={save.isPending}
            isSaveDisabled={unchanged}
          />
        )}
      </SettingsForm>
    </SettingsSection>
  )
}
