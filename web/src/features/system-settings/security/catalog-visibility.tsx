import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { UserIdentity } from '@/components/user-identity'
import { UserSelector } from '@/components/user-selector'
import { getEnabledModels } from '@/features/channels/api'
import { getGroups } from '@/features/users/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { FormNavigationGuard } from '../components/form-navigation-guard'
import { SettingsCard } from '../components/settings-card'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { useUpdateOption } from '../hooks/use-update-option'

const audiences = z.record(z.string(), z.array(z.string()))
const policy = z
  .object({
    audiences: z.record(z.string(), z.array(z.number().int().positive())),
    models: audiences,
    groups: audiences,
  })
  .strict()
type Policy = z.infer<typeof policy>

function options(names: string[]) {
  return [...new Set(names)]
    .sort()
    .map((name) => ({ label: name, value: name }))
}

export function CatalogVisibilityPage({ saved }: { saved: string }) {
  const { t } = useTranslation()
  const [original] = useState(() => {
    try {
      return policy.parse(JSON.parse(saved))
    } catch {
      return null
    }
  })
  const [draft, setDraft] = useState(original)
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
  })
  const models = useQuery({
    queryKey: ['enabled-models'],
    queryFn: async () => requireServerSuccess(await getEnabledModels()),
  })
  const update = useUpdateOption()
  const id = useId()
  if (!draft || !original) {
    return <ErrorState title={t('Cannot load visibility rules')} />
  }
  if (groups.isError || models.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void groups.refetch()
          void models.refetch()
        }}
      />
    )
  }
  if (groups.isPending || models.isPending) return <LoadingState />
  const dirty = JSON.stringify(draft) !== JSON.stringify(original)
  const groupNames = groups.data.data ?? []
  const sections = [
    {
      key: 'models',
      title: t('Restricted models'),
      targets: models.data.data ?? [],
    },
    {
      key: 'groups',
      title: t('Restricted routing groups'),
      targets: groupNames,
    },
  ] as const
  function change(kind: 'models' | 'groups', rules: Policy['models']) {
    setDraft((current) => current && { ...current, [kind]: rules })
  }
  function setMembership(group: string, members: number[]) {
    setDraft(
      (current) =>
        current && {
          ...current,
          audiences: { ...current.audiences, [group]: [...new Set(members)] },
        }
    )
  }

  return (
    <>
      <FormNavigationGuard when={dirty} />
      <SettingsPageFormActions
        isSaving={update.isPending}
        isSaveDisabled={!dirty}
        isResetDisabled={!dirty}
        onReset={() => setDraft(original)}
        onSave={() =>
          update.mutate({
            key: 'CatalogVisibility',
            value: JSON.stringify(draft),
          })
        }
      />
      <p className='text-muted-foreground text-sm'>
        {t(
          'Visibility rules only narrow existing access. They do not change pricing or grant access to a channel.'
        )}
      </p>
      <SettingsCard
        title={t('Permission groups')}
        description={t(
          'Create a permission group and add accounts. An account may belong to several permission groups without changing its pricing group.'
        )}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-audiences`}>
              {t('Permission groups')}
            </FieldLabel>
            <MultiSelect
              id={`${id}-audiences`}
              allowCreate
              disabled={update.isPending}
              options={options(Object.keys(draft.audiences))}
              selected={Object.keys(draft.audiences)}
              onChange={(names) => {
                const retained = new Set(names)
                const prune = (resources: Policy['models']) =>
                  Object.fromEntries(
                    Object.entries(resources).map(([name, audience]) => [
                      name,
                      audience.filter((entry) => retained.has(entry)),
                    ])
                  )
                setDraft({
                  audiences: Object.fromEntries(
                    names.map((name) => [
                      name,
                      Object.hasOwn(draft.audiences, name)
                        ? draft.audiences[name]
                        : [],
                    ])
                  ),
                  models: prune(draft.models),
                  groups: prune(draft.groups),
                })
              }}
            />
          </Field>
          {Object.entries(draft.audiences).map(([name, members], index) => (
            <Field key={name}>
              <FieldLabel htmlFor={`${id}-members-${index}`}>
                {t('Members of {{name}}', { name })}
              </FieldLabel>
              <UserSelector
                id={`${id}-members-${index}`}
                disabled={update.isPending}
                onChange={(userID) => {
                  if (userID) setMembership(name, [...members, userID])
                }}
              />
              {members.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {members.map((userID) => (
                    <Button
                      key={userID}
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={update.isPending}
                      aria-label={t('Remove user #{{id}}', { id: userID })}
                      onClick={() =>
                        setMembership(
                          name,
                          members.filter((member) => member !== userID)
                        )
                      }
                    >
                      <UserIdentity userId={userID} /> ×
                    </Button>
                  ))}
                </div>
              )}
            </Field>
          ))}
        </FieldGroup>
      </SettingsCard>
      {sections.map(({ key, title, targets }) => (
        <SettingsCard
          key={key}
          title={title}
          description={t(
            'Select resources to restrict. Removing a resource restores its usual visibility.'
          )}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-${key}`}>{title}</FieldLabel>
              <MultiSelect
                id={`${id}-${key}`}
                disabled={update.isPending}
                options={options([...targets, ...Object.keys(draft[key])])}
                selected={Object.keys(draft[key])}
                onChange={(names) =>
                  change(
                    key,
                    Object.fromEntries(
                      names.map((name) => [
                        name,
                        Object.hasOwn(draft[key], name) ? draft[key][name] : [],
                      ])
                    )
                  )
                }
              />
            </Field>
            {Object.entries(draft[key]).map(([name, audience], index) => (
              <Field key={name}>
                <FieldLabel htmlFor={`${id}-${key}-${index}`}>
                  {t('Permission groups allowed to see {{name}}', { name })}
                </FieldLabel>
                <MultiSelect
                  id={`${id}-${key}-${index}`}
                  disabled={update.isPending}
                  options={options(Object.keys(draft.audiences))}
                  selected={audience}
                  placeholder={t('Hidden from everyone')}
                  onChange={(members) =>
                    change(key, { ...draft[key], [name]: members })
                  }
                />
              </Field>
            ))}
          </FieldGroup>
        </SettingsCard>
      ))}
    </>
  )
}
