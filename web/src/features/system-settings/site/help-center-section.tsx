/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  helpCenterSchema,
  type HelpCenterConfig,
} from '@/features/help-center/config'
import { HelpContent } from '@/features/help-center/help-content'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { HelpImageUpload } from './help-image-upload'

export function HelpCenterSection(props: { defaultValue: string }) {
  const { t } = useTranslation()
  const update = useUpdateOption()
  const [preview, setPreview] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const htmlViewModes = [
    { value: 'preview', label: t('Preview only') },
    { value: 'split', label: t('Source comparison only') },
    { value: 'both', label: t('Both views') },
  ]
  const defaults = useMemo<HelpCenterConfig>(() => {
    if (!props.defaultValue) return { version: 1, items: [] }
    return helpCenterSchema.parse(JSON.parse(props.defaultValue))
  }, [props.defaultValue])
  const form = useForm<HelpCenterConfig>({
    resolver: zodResolver(helpCenterSchema),
    defaultValues: defaults,
  })
  const fields = useFieldArray({
    control: form.control,
    name: 'items',
    keyName: 'fieldKey',
  })
  useEffect(() => form.reset(defaults), [defaults, form])
  const items = form.watch('items')
  const save = form.handleSubmit(async (values) => {
    await update.mutateAsync({
      key: 'HelpCenter',
      value: JSON.stringify(values),
    })
  })

  return (
    <SettingsSection title={t('Help Center')}>
      <Form {...form}>
        <SettingsForm onSubmit={save}>
          <SettingsPageFormActions onSave={save} isSaving={update.isPending} />
          <p className='text-muted-foreground text-sm'>
            {t(
              'Manage public guides and previews. Changes take effect after saving, without rebuilding.'
            )}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'HTML previews run in isolation. HTTPS images are supported; external scripts and embedded pages are blocked.'
            )}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Use public HTTPS image URLs in HTML or Markdown. Local file paths are not supported.'
            )}
          </p>
          {Object.keys(form.formState.errors).length > 0 && (
            <p role='alert' className='text-destructive text-sm'>
              {t(
                'Check titles, unique IDs and HTTP(S) links. Maximum: 100 items and 2 MiB total.'
              )}
            </p>
          )}
          {fields.fields.map((item, index) => (
            <fieldset
              key={item.fieldKey}
              className='min-w-0 space-y-4 rounded-xl border p-4'
            >
              <legend className='max-w-full truncate px-2 text-sm font-medium'>
                {items[index]?.title || t('New help item')}
              </legend>
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={index === 0}
                  onClick={() => fields.move(index, index - 1)}
                >
                  {t('Move up')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={index === fields.fields.length - 1}
                  onClick={() => fields.move(index, index + 1)}
                >
                  {t('Move down')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setPreview(index)}
                >
                  {t('Preview')}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setDeleting(index)}
                >
                  {t('Delete')}
                </Button>
              </div>
              <div className='grid gap-4 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name={`items.${index}.title`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Title')}</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={120} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`items.${index}.id`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('ID')}</FormLabel>
                      <FormControl>
                        <Input {...field} maxLength={64} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`items.${index}.kind`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Content type')}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value='markdown'>
                            {t('Markdown')}
                          </SelectItem>
                          <SelectItem value='html'>
                            {t('HTML preview')}
                          </SelectItem>
                          <SelectItem value='link'>
                            {t('External link')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`items.${index}.enabled`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Visible')}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              {items[index]?.kind === 'html' && (
                <FormField
                  control={form.control}
                  name={`items.${index}.htmlViewMode`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('HTML display mode')}</FormLabel>
                      <Select
                        items={htmlViewModes}
                        value={field.value ?? 'both'}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className='w-full sm:w-72'>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {htmlViewModes.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                              {mode.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {t('Choose which HTML views visitors can use.')}
                      </FormDescription>
                    </FormItem>
                  )}
                />
              )}
              {items[index]?.kind !== 'link' && (
                <HelpImageUpload
                  onUploaded={(url) => {
                    const current = form.getValues(`items.${index}`)
                    if (current.kind === 'link') return
                    let content: string
                    if (current.kind === 'html') {
                      const safeURL = url
                        .replaceAll('&', '&amp;')
                        .replaceAll('"', '&quot;')
                        .replaceAll('<', '&lt;')
                        .replaceAll('>', '&gt;')
                      const image = `<img src="${safeURL}" alt="" style="max-width:100%;height:auto">`
                      const bodyEnd = current.content
                        .toLowerCase()
                        .lastIndexOf('</body>')
                      const position =
                        bodyEnd >= 0 ? bodyEnd : current.content.length
                      content = `${current.content.slice(0, position)}\n${image}\n${current.content.slice(position)}`
                    } else {
                      content = `${current.content}\n\n![](<${url.replaceAll('>', '%3E').replaceAll('<', '%3C')}>)\n`
                    }
                    form.setValue(`items.${index}.content`, content, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }}
                />
              )}
              <FormField
                control={form.control}
                name={`items.${index}.content`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {items[index]?.kind === 'link' ? t('URL') : t('Content')}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={10}
                        className='font-mono text-sm'
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </fieldset>
          ))}
          <Button
            type='button'
            variant='outline'
            disabled={items.length >= 100}
            onClick={() =>
              fields.append({
                id: crypto.randomUUID(),
                title: t('New help item'),
                kind: 'markdown',
                content: '',
                enabled: true,
              })
            }
          >
            {t('Add help item')}
          </Button>
        </SettingsForm>
      </Form>
      <Dialog
        title={t('Preview')}
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        contentClassName='sm:max-w-5xl'
      >
        {preview !== null &&
          items[preview] &&
          helpCenterSchema.safeParse({ version: 1, items: [items[preview]] })
            .success && <HelpContent item={items[preview]} />}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete help item')}
        desc={t('This item will be removed when you save.')}
        destructive
        handleConfirm={() => {
          if (deleting !== null) fields.remove(deleting)
          setDeleting(null)
        }}
      />
    </SettingsSection>
  )
}
