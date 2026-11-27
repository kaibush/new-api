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
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getEnabledModels } from '@/features/channels/api'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getGroups } from '../api'
import { PermissionGroupForm } from './group-form'
import {
  changeGroup,
  clearResourceRules,
  groupResources,
  nameOptions,
  orphanedResourcesOnGroupDelete,
  restrictedResources,
  type Policy,
  type ResourceKind,
} from './lib/policy'
import { ResourceCatalogPanel } from './resource-catalog-panel'
import { ResourceRuleForm } from './rule-form'
import { useCatalogVisibility } from './use-catalog-visibility'

type ActiveTab = 'models' | 'groups' | 'audiences'

type Editor =
  | { type: 'group'; name?: string }
  | { type: 'rule'; kind: ResourceKind; names?: string[] }
  | { type: 'delete-group'; name: string }
  | { type: 'delete-rule'; kind: ResourceKind; names: string[] }

function GroupRow(props: {
  name: string
  detail: string
  onEdit: () => void
  onRemove: () => void
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
          className='min-h-11 sm:min-h-9'
          size='sm'
          variant='outline'
          onClick={props.onEdit}
        >
          {t('Edit')}
        </Button>
        <Button
          className='min-h-11 sm:min-h-9'
          size='sm'
          variant='ghost'
          onClick={props.onRemove}
        >
          {t('Delete')}
        </Button>
      </div>
    </li>
  )
}

export function PermissionGroups(props: { embedded?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const catalog = useCatalogVisibility()
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
  })
  const models = useQuery({
    queryKey: ['enabled-models'],
    queryFn: async () => requireServerSuccess(await getEnabledModels()),
  })

  const [activeTab, setActiveTab] = useState<ActiveTab>('models')
  const [clearOrphanedOnDelete, setClearOrphanedOnDelete] = useState(false)
  const [session, setSession] = useState<{
    editor: Editor
    policy: Policy
  } | null>(null)

  const policy = catalog.policy
  const restricted = useMemo(
    () => ({
      models: restrictedResources(policy, 'models'),
      groups: restrictedResources(policy, 'groups'),
    }),
    [policy]
  )
  const allNames = useMemo(
    () => ({
      models: [
        ...new Set([...(models.data?.data ?? []), ...restricted.models]),
      ].sort(),
      groups: [
        ...new Set([...(groups.data?.data ?? []), ...restricted.groups]),
      ].sort(),
    }),
    [models.data, groups.data, restricted]
  )
  const targets = useMemo(
    () => ({
      models: nameOptions(allNames.models),
      groups: nameOptions(allNames.groups),
    }),
    [allNames]
  )

  if (catalog.isError || groups.isError || models.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void catalog.refetch()
          void groups.refetch()
          void models.refetch()
        }}
      />
    )
  }
  if (catalog.isPending || groups.isPending || models.isPending) {
    return <LoadingState />
  }
  if (catalog.invalid || !policy) {
    return (
      <ErrorState
        title={t('Cannot load visibility rules')}
        onRetry={() => void catalog.refetch()}
      />
    )
  }

  const editor = session?.policy === policy ? session.editor : null
  const openEditor = (nextEditor: Editor) => {
    if (nextEditor.type === 'delete-group') {
      setClearOrphanedOnDelete(false)
    }
    setSession({ editor: nextEditor, policy })
  }
  const close = () => setSession(null)
  const save = (next: Policy) => catalog.savePolicy(next, close)

  const audienceEntries = Object.entries(policy.audiences)
  const orphanedOnDelete =
    editor?.type === 'delete-group'
      ? orphanedResourcesOnGroupDelete(policy, editor.name)
      : { models: [], groups: [] }
  const orphanedList = [...orphanedOnDelete.models, ...orphanedOnDelete.groups]

  const workspace = (
    <div className='grid max-w-5xl min-w-0 gap-4'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Control which models and routing groups each user can view and call. Any model or routing group granted here works directly across regular API keys without rebinding token groups.'
        )}
      </p>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ActiveTab)}
      >
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
            <TabsTrigger value='models'>
              {t('Model permissions')} (
              {formatNumber(allNames.models.length, locale)})
            </TabsTrigger>
            <TabsTrigger value='groups'>
              {t('Routing group permissions')} (
              {formatNumber(allNames.groups.length, locale)})
            </TabsTrigger>
            <TabsTrigger value='audiences'>
              {t('Permission groups')} (
              {formatNumber(audienceEntries.length, locale)})
            </TabsTrigger>
          </TabsList>
          {props.embedded && (
            <Button
              size='sm'
              className='min-h-11 sm:min-h-9'
              onClick={() => {
                setActiveTab('audiences')
                openEditor({ type: 'group' })
              }}
            >
              <Plus aria-hidden='true' />
              {t('New permission group')}
            </Button>
          )}
        </div>

        <TabsContent value='models' className='mt-4'>
          <ResourceCatalogPanel
            kind='models'
            names={allNames.models}
            policy={policy}
            pending={catalog.isSaving}
            onEdit={(names) =>
              openEditor({ type: 'rule', kind: 'models', names })
            }
            onAddRule={() => openEditor({ type: 'rule', kind: 'models' })}
            onRemoveRule={(names) =>
              openEditor({ type: 'delete-rule', kind: 'models', names })
            }
          />
        </TabsContent>

        <TabsContent value='groups' className='mt-4'>
          <ResourceCatalogPanel
            kind='groups'
            names={allNames.groups}
            policy={policy}
            pending={catalog.isSaving}
            onEdit={(names) =>
              openEditor({ type: 'rule', kind: 'groups', names })
            }
            onAddRule={() => openEditor({ type: 'rule', kind: 'groups' })}
            onRemoveRule={(names) =>
              openEditor({ type: 'delete-rule', kind: 'groups', names })
            }
          />
        </TabsContent>

        <TabsContent value='audiences' className='mt-4'>
          <div className='grid gap-4'>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Create reusable account groups (for example beta testers or restricted accounts) without changing user billing groups.'
              )}
            </p>
            {audienceEntries.length > 0 ? (
              <ul
                aria-label={t('Permission groups')}
                className='divide-y rounded-xl border px-4'
              >
                {audienceEntries.map(([name, members]) => (
                  <GroupRow
                    key={name}
                    name={name}
                    detail={t(
                      '{{members}} members · {{models}} models · {{groups}} routing groups',
                      {
                        members: formatNumber(members.length, locale),
                        models: formatNumber(
                          groupResources(policy.models, name).length,
                          locale
                        ),
                        groups: formatNumber(
                          groupResources(policy.groups, name).length,
                          locale
                        ),
                      }
                    )}
                    onEdit={() => openEditor({ type: 'group', name })}
                    onRemove={() => openEditor({ type: 'delete-group', name })}
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
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )

  return (
    <>
      {props.embedded ? (
        <div className='h-full overflow-y-auto pr-1 pb-6'>{workspace}</div>
      ) : (
        <SectionPageLayout>
          <SectionPageLayout.Title>
            {t('Permission groups')}
          </SectionPageLayout.Title>
          <SectionPageLayout.Actions>
            <Button
              className='min-h-11'
              onClick={() => {
                setActiveTab('audiences')
                openEditor({ type: 'group' })
              }}
            >
              <Plus aria-hidden='true' />
              {t('New permission group')}
            </Button>
          </SectionPageLayout.Actions>
          <SectionPageLayout.Content>{workspace}</SectionPageLayout.Content>
        </SectionPageLayout>
      )}

      {editor?.type === 'group' && (
        <PermissionGroupForm
          name={editor.name}
          policy={policy}
          targets={targets}
          pending={catalog.isSaving}
          onClose={close}
          onSave={save}
        />
      )}

      {editor?.type === 'rule' && (
        <ResourceRuleForm
          kind={editor.kind}
          names={editor.names}
          policy={policy}
          targets={targets[editor.kind]}
          pending={catalog.isSaving}
          onClose={close}
          onSave={save}
        />
      )}

      <ConfirmDialog
        open={editor?.type === 'delete-group'}
        onOpenChange={(open) => {
          if (!open && !catalog.isSaving) close()
        }}
        destructive
        isLoading={catalog.isSaving}
        title={t('Delete permission group')}
        desc={
          editor?.type === 'delete-group'
            ? t(
                'Deleting "{{name}}" revokes access granted through this group.',
                { name: editor.name }
              )
            : ''
        }
        confirmText={t('Delete')}
        handleConfirm={() => {
          if (editor?.type === 'delete-group') {
            save(
              changeGroup(policy, editor.name, undefined, clearOrphanedOnDelete)
            )
          }
        }}
      >
        {orphanedList.length > 0 && (
          <div className='mt-2 space-y-2 rounded-lg border p-3 text-sm'>
            <p className='text-muted-foreground'>
              {t(
                'Resources with no remaining allowlist groups ({{items}}) stay hidden unless you restore default access:',
                { items: orphanedList.join(', ') }
              )}
            </p>
            <label className='flex cursor-pointer items-center gap-2 font-medium'>
              <Checkbox
                checked={clearOrphanedOnDelete}
                onCheckedChange={(checked) =>
                  setClearOrphanedOnDelete(Boolean(checked))
                }
              />
              <span>
                {t('Also restore default access for affected resources')}
              </span>
            </label>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={editor?.type === 'delete-rule'}
        onOpenChange={(open) => {
          if (!open && !catalog.isSaving) close()
        }}
        destructive
        isLoading={catalog.isSaving}
        title={t('Remove restriction')}
        desc={
          editor?.type === 'delete-rule'
            ? t('Restore the usual visibility of {{name}}?', {
                name: editor.names.join(', '),
              })
            : ''
        }
        confirmText={t('Remove restriction')}
        handleConfirm={() => {
          if (editor?.type === 'delete-rule') {
            save(clearResourceRules(policy, editor.kind, editor.names))
          }
        }}
      />
    </>
  )
}
