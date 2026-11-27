import { useQuery } from '@tanstack/react-query'
import { Plus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardAction,
} from '@/components/ui/card'
import { getEnabledModels } from '@/features/channels/api'
import { useSystemOptions } from '@/features/system-settings/hooks/use-system-options'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getGroups } from '../api'
import { PermissionGroupForm } from './group-form'
import {
  changeGroup,
  groupResources,
  nameOptions,
  parsePolicy,
  resourceKinds,
  type Policy,
  type ResourceKind,
} from './lib/policy'
import { ResourceRuleForm } from './rule-form'

type Editor =
  | { type: 'group'; name?: string }
  | { type: 'rule'; kind: ResourceKind; name?: string }
  | { type: 'delete'; name: string; kind?: ResourceKind }

function PolicyRow(props: {
  name: string
  detail: string
  onEdit: () => void
  onRemove: () => void
  removeLabel: string
}) {
  const { t } = useTranslation()
  return (
    <li
      aria-label={props.name}
      className='flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between'
    >
      <div className='min-w-0 space-y-1 wrap-anywhere'>
        <p className='font-medium'>{props.name}</p>
        <p className='text-muted-foreground text-sm'>{props.detail}</p>
      </div>
      <div className='grid shrink-0 grid-cols-2 gap-2 sm:flex'>
        <Button
          className='min-h-11'
          size='sm'
          variant='outline'
          onClick={props.onEdit}
        >
          {t('Edit')}
        </Button>
        <Button
          className='min-h-11'
          size='sm'
          variant='ghost'
          onClick={props.onRemove}
        >
          {props.removeLabel}
        </Button>
      </div>
    </li>
  )
}

export function PermissionGroups() {
  const { t } = useTranslation()
  const options = useSystemOptions()
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
  })
  const models = useQuery({
    queryKey: ['enabled-models'],
    queryFn: async () => requireServerSuccess(await getEnabledModels()),
  })
  const update = useUpdateOption()
  const [session, setSession] = useState<{
    editor: Editor
    policy: Policy
  } | null>(null)
  const saved = options.data?.data.find(
    (option) => option.key === 'CatalogVisibility'
  )?.value
  const policy = useMemo(() => parsePolicy(saved), [saved])
  const targets = useMemo(
    () => ({
      models: nameOptions([
        ...(models.data?.data ?? []),
        ...Object.keys(policy?.models ?? {}),
      ]),
      groups: nameOptions([
        ...(groups.data?.data ?? []),
        ...Object.keys(policy?.groups ?? {}),
      ]),
    }),
    [models.data, groups.data, policy]
  )
  if (options.isError || groups.isError || models.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void options.refetch()
          void groups.refetch()
          void models.refetch()
        }}
      />
    )
  }
  if (options.isPending || groups.isPending || models.isPending) {
    return <LoadingState />
  }
  if (!policy) {
    return (
      <ErrorState
        title={t('Cannot load visibility rules')}
        onRetry={() => void options.refetch()}
      />
    )
  }
  const editor = session?.policy === policy ? session.editor : null
  const openEditor = (editor: Editor) => setSession({ editor, policy })
  const close = () => setSession(null)
  const save = (next: Policy) =>
    update.mutate(
      { key: 'CatalogVisibility', value: JSON.stringify(next) },
      { onSuccess: close }
    )
  const formProps = {
    policy,
    pending: update.isPending,
    onClose: close,
    onSave: save,
  }
  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Permission groups')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            className='min-h-11'
            onClick={() => openEditor({ type: 'group' })}
          >
            <Plus />
            {t('New permission group')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='grid max-w-4xl min-w-0 gap-4'>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Create a permission group and add accounts. An account may belong to several permission groups without changing its pricing group.'
              )}
            </p>
            {Object.keys(policy.audiences).length ? (
              <ul
                aria-label={t('Permission groups')}
                className='divide-y rounded-xl border px-4'
              >
                {Object.entries(policy.audiences).map(([name, members]) => (
                  <PolicyRow
                    key={name}
                    name={name}
                    detail={t(
                      '{{members}} members · {{models}} models · {{groups}} routing groups',
                      {
                        members: formatNumber(members.length),
                        models: formatNumber(
                          groupResources(policy.models, name).length
                        ),
                        groups: formatNumber(
                          groupResources(policy.groups, name).length
                        ),
                      }
                    )}
                    onEdit={() => openEditor({ type: 'group', name })}
                    onRemove={() => openEditor({ type: 'delete', name })}
                    removeLabel={t('Delete')}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                bordered
                className='min-h-32'
                icon={Users}
                title={t('No permission groups yet')}
              />
            )}
            <p className='text-muted-foreground mt-2 text-sm'>
              {t(
                'Select resources to restrict. Removing a resource restores its usual visibility.'
              )}
            </p>
            {resourceKinds.map((kind) => (
              <Card key={kind}>
                <CardHeader>
                  <CardTitle>
                    {kind === 'models'
                      ? t('Restricted models')
                      : t('Restricted routing groups')}
                  </CardTitle>
                  <CardAction>
                    <Button
                      className='min-h-11'
                      variant='outline'
                      size='sm'
                      disabled={
                        !targets[kind].some(
                          ({ value }) => !Object.hasOwn(policy[kind], value)
                        )
                      }
                      onClick={() => openEditor({ type: 'rule', kind })}
                    >
                      <Plus />
                      {t('Add rule')}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {Object.keys(policy[kind]).length ? (
                    <ul className='divide-y'>
                      {Object.entries(policy[kind]).map(([name, allowed]) => (
                        <PolicyRow
                          key={name}
                          name={name}
                          detail={
                            allowed.length
                              ? allowed.join(' · ')
                              : t('Hidden from everyone')
                          }
                          removeLabel={t('Remove restriction')}
                          onEdit={() =>
                            openEditor({ type: 'rule', kind, name })
                          }
                          onRemove={() =>
                            openEditor({ type: 'delete', kind, name })
                          }
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      {t('No rules yet')}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {editor?.type === 'group' && (
        <PermissionGroupForm
          {...formProps}
          name={editor.name}
          targets={targets}
        />
      )}
      {editor?.type === 'rule' && (
        <ResourceRuleForm
          {...formProps}
          kind={editor.kind}
          name={editor.name}
          targets={targets[editor.kind]}
        />
      )}
      {editor?.type === 'delete' && (
        <ConfirmDialog
          open
          className='wrap-anywhere max-sm:[&_button]:min-h-11'
          destructive
          isLoading={update.isPending}
          onOpenChange={(open) => {
            if (!open && !update.isPending) close()
          }}
          title={
            editor.kind ? t('Remove restriction') : t('Delete permission group')
          }
          confirmText={editor.kind ? t('Remove restriction') : t('Delete')}
          desc={
            editor.kind
              ? t('Restore the usual visibility of {{name}}?', {
                  name: editor.name,
                })
              : t(
                  'Delete {{name}}? Resources with no remaining permission groups stay hidden.',
                  { name: editor.name }
                )
          }
          handleConfirm={() => {
            if (!editor.kind) return save(changeGroup(policy, editor.name))
            const rules = { ...policy[editor.kind] }
            delete rules[editor.name]
            save({ ...policy, [editor.kind]: rules })
          }}
        />
      )}
    </>
  )
}
