import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { JsonCodeEditor } from '@/components/json-code-editor'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { FormNavigationGuard } from '@/features/system-settings/components/form-navigation-guard'

import { BoardRenderer } from '../community-board'
import { useRedPackets } from '../use-red-packets'
import { BoardActionsEditor } from './actions-editor'
import { getBoard, saveBoard } from './api'
import {
  boardSchema,
  blockTypes,
  defaultBoard,
  normalizeBoard,
  type BoardDocument,
} from './schema'

export function BoardStudio() {
  const query = useQuery({
    queryKey: ['community-board-admin'],
    queryFn: () => getBoard(true),
  })
  if (query.isPending) return <LoadingState />
  if (query.isError && !query.data)
    return <ErrorState onRetry={() => void query.refetch()} />
  return <BoardEditor initial={query.data} />
}
export function BoardEditor(props: { initial: BoardDocument }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<BoardDocument>({
    resolver: zodResolver(boardSchema),
    defaultValues: normalizeBoard(props.initial),
  })
  const fields = useFieldArray({
    control: form.control,
    name: 'blocks',
    keyName: 'fieldKey',
  })
  const [kind, setKind] =
    useState<(typeof blockTypes)[number]>('custom.action_card')
  const [confirm, setConfirm] = useState<'reset' | 'reload' | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [json, setJson] = useState('')
  const [importError, setImportError] = useState(false)
  const document = form.watch()
  const labels: Record<(typeof blockTypes)[number], string> = {
    'builtin.checkin': t('Daily Check-in'),
    'builtin.checkin_leaderboard': t('Check-in leaderboard'),
    'builtin.events': t('Upcoming events'),
    'builtin.red_packets': t('Red packets'),
    'builtin.red_packet_rules': t('About red packets'),
    'custom.action_card': t('Action card'),
    'custom.notice': t('Notice'),
    'custom.link_grid': t('Link grid'),
    'custom.banner': t('Banner'),
    'custom.copy_card': t('Copy card'),
  }
  const save = useMutation({
    mutationFn: saveBoard,
    onSuccess: (result) => {
      form.reset(result)
      client.setQueryData(['community-board-admin'], result)
      void client.invalidateQueries({ queryKey: ['community-board'] })
      toast.success(t('Saved successfully'))
    },
  })
  const reload = useMutation({
    mutationFn: () => getBoard(true),
    onSuccess: (result) => form.reset(result),
  })
  return (
    <form
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      className='space-y-4'
    >
      <FormNavigationGuard when={form.formState.isDirty} />
      <p className='text-muted-foreground text-sm'>
        {t(
          'Arrange blocks, then save to publish. Online users receive updates automatically.'
        )}
      </p>
      <fieldset
        disabled={save.isPending || reload.isPending}
        className='space-y-4'
      >
        <div className='flex flex-wrap gap-2'>
          <Button type='submit' disabled={!form.formState.isDirty}>
            {t('Save')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => setConfirm('reset')}
          >
            {t('Restore defaults')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => setConfirm('reload')}
          >
            {t('Reload')}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              setJson(JSON.stringify(document, null, 2))
              setImportError(false)
              setTransferOpen(true)
            }}
          >
            {t('Import / Export')}
          </Button>
        </div>
        {save.isError && (
          <p role='alert' className='text-destructive text-sm'>
            {t(
              'Save failed. Your edits are kept. Reload to discard them and fetch the latest version.'
            )}
          </p>
        )}
        <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]'>
          <div className='min-w-0 space-y-4'>
            <label className='block space-y-1'>
              <span>{t('Title')}</span>
              <Input
                {...form.register('title')}
                maxLength={240}
                placeholder={t('Community board')}
              />
            </label>
            <label className='block space-y-1'>
              <span>{t('Subtitle')}</span>
              <Input {...form.register('subtitle')} maxLength={600} />
            </label>
            <div className='flex flex-wrap gap-2'>
              <NativeSelect
                aria-label={t('Block type')}
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                {blockTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {labels[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                type='button'
                variant='outline'
                disabled={
                  fields.fields.length >= 30 ||
                  (kind.startsWith('builtin.') &&
                    kind !== 'builtin.checkin_leaderboard' &&
                    document.blocks.some((b) => b.type === kind))
                }
                onClick={() =>
                  fields.append({
                    id: crypto.randomUUID(),
                    type: kind,
                    enabled: true,
                    title: '',
                    body: '',
                    image_url: '',
                    actions:
                      kind === 'custom.copy_card'
                        ? [{ type: 'copy_text', label: t('Copy'), value: '' }]
                        : [],
                  })
                }
              >
                {t('Add block')}
              </Button>
            </div>
            {fields.fields.map((field, index) => {
              const block = document.blocks[index]
              const custom = block.type.startsWith('custom.')
              return (
                <section
                  key={field.fieldKey}
                  className='space-y-3 rounded-lg border p-4'
                  aria-label={labels[block.type]}
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <strong className='mr-auto text-sm'>
                      {labels[block.type]}
                    </strong>
                    <Controller
                      control={form.control}
                      name={`blocks.${index}.enabled`}
                      render={({ field }) => (
                        <Switch
                          aria-label={t('Enabled')}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      aria-label={t('Move up')}
                      disabled={index === 0}
                      onClick={() => fields.move(index, index - 1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      aria-label={t('Move down')}
                      disabled={index === fields.fields.length - 1}
                      onClick={() => fields.move(index, index + 1)}
                    >
                      ↓
                    </Button>
                    {(custom ||
                      block.type === 'builtin.checkin_leaderboard') && (
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        disabled={fields.fields.length >= 30}
                        onClick={() =>
                          fields.insert(index + 1, {
                            ...structuredClone(block),
                            id: crypto.randomUUID(),
                          })
                        }
                      >
                        {t('Duplicate')}
                      </Button>
                    )}
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => fields.remove(index)}
                    >
                      {t('Remove')}
                    </Button>
                  </div>
                  {block.type === 'builtin.checkin_leaderboard' && (
                    <div className='grid gap-3 sm:grid-cols-2'>
                      <label>
                        <span>{t('Block title')}</span>
                        <Input
                          {...form.register(`blocks.${index}.title`)}
                          maxLength={240}
                        />
                      </label>
                      <label>
                        <span>{t('Leaderboard view')}</span>
                        <NativeSelect
                          {...form.register(`blocks.${index}.leaderboard_tab`)}
                          defaultValue='today'
                        >
                          <NativeSelectOption value='today'>
                            {t("Today's check-in leaderboard")}
                          </NativeSelectOption>
                          <NativeSelectOption value='highlights'>
                            {t('Recent jackpots')}
                          </NativeSelectOption>
                          <NativeSelectOption value='total'>
                            {t('Recent total rewards')}
                          </NativeSelectOption>
                        </NativeSelect>
                      </label>
                      <label>
                        <span>{t('Preview count')}</span>
                        <Input
                          type='number'
                          min={3}
                          max={10}
                          defaultValue={5}
                          {...form.register(
                            `blocks.${index}.leaderboard_limit`,
                            { valueAsNumber: true }
                          )}
                        />
                      </label>
                      <Controller
                        control={form.control}
                        name={`blocks.${index}.leaderboard_route`}
                        render={({ field }) => (
                          <label className='flex items-center gap-2'>
                            <Switch
                              checked={field.value ?? false}
                              onCheckedChange={field.onChange}
                            />
                            <span>{t('Open full page')}</span>
                          </label>
                        )}
                      />
                    </div>
                  )}
                  {custom && (
                    <>
                      <label className='block space-y-1'>
                        <span>{t('Title')}</span>
                        <Input
                          {...form.register(`blocks.${index}.title`)}
                          maxLength={240}
                        />
                      </label>
                      <label className='block space-y-1'>
                        <span>{t('Content')} (Markdown)</span>
                        <Textarea
                          {...form.register(`blocks.${index}.body`)}
                          maxLength={12000}
                          rows={3}
                        />
                      </label>
                      <label className='block space-y-1'>
                        <span>{t('Image URL')}</span>
                        <Input
                          {...form.register(`blocks.${index}.image_url`)}
                          maxLength={2048}
                          aria-invalid={
                            !!form.formState.errors.blocks?.[index]?.image_url
                          }
                        />
                      </label>
                      <BoardActionsEditor form={form} index={index} />
                    </>
                  )}
                </section>
              )
            })}
          </div>
          <aside className='min-w-0 space-y-4' aria-label={t('Preview')}>
            <h3 className='font-semibold'>{t('Preview')}</h3>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Preview uses live data. Built-in write actions are disabled.'
              )}
            </p>
            <BoardPreview document={document} />
          </aside>
        </div>
      </fieldset>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={confirm === 'reset' ? t('Restore defaults') : t('Reload')}
        desc={t('Unsaved changes will be discarded. Continue?')}
        handleConfirm={() => {
          if (confirm === 'reset') {
            form.reset(
              { ...defaultBoard(), version: document.version },
              { keepDefaultValues: true }
            )
          } else reload.mutate()
          setConfirm(null)
        }}
      />
      <Dialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title={t('Import / Export')}
        footer={
          <>
            <CopyButton value={json} variant='outline' size='sm'>
              {t('Copy')}
            </CopyButton>
            <Button
              type='button'
              onClick={() => {
                try {
                  const parsed = normalizeBoard(
                    boardSchema.parse(JSON.parse(json))
                  )
                  form.reset(
                    { ...parsed, version: document.version },
                    { keepDefaultValues: true }
                  )
                  setTransferOpen(false)
                } catch {
                  setImportError(true)
                }
              }}
            >
              {t('Import')}
            </Button>
          </>
        }
      >
        <JsonCodeEditor
          value={json}
          onChange={setJson}
          ariaLabel={t('Board configuration')}
        />
        {importError && (
          <p role='alert' className='text-destructive'>
            {t('Invalid community board configuration')}
          </p>
        )}
      </Dialog>
      {Object.keys(form.formState.errors).length > 0 && (
        <p role='alert' className='text-destructive'>
          {t('Check titles, URLs and action values before saving.')}
        </p>
      )}
    </form>
  )
}

function BoardPreview(props: { document: BoardDocument }) {
  const packets = useRedPackets([])
  return (
    <BoardRenderer
      document={props.document}
      preview
      packetMessages={[]}
      packets={packets}
      onOpen={() => {}}
      onCreate={() => {}}
      onOpenEvent={() => {}}
      onCreateEvent={() => {}}
    />
  )
}
