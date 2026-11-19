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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { JsonCodeEditor } from '@/components/json-code-editor'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ModelPricingEditorPanel,
  type ModelPricingEditorPanelHandle,
} from '@/features/system-settings/models/model-pricing-sheet'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getModelPricing,
  previewModelPricing,
  useSaveModelPricing,
  type ModelPricingEntry,
} from './api'
import { pricingFromDraft, pricingRow, type PricingValues } from './pricing'
import {
  exportModelPricing,
  MAX_PRICING_IMPORT_BYTES,
  mergePricingEditorDraft,
  parsePricingImport,
} from './pricing-transfer'

export function PricingTransferDialog(props: {
  entry: ModelPricingEntry
  mode: 'import' | 'export'
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const fileId = useId()
  const exporting = props.mode === 'export'
  const [targetEntry, setTargetEntry] = useState(props.entry)
  const downloadUrl = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current)
    },
    []
  )
  const [json, setJson] = useState(() =>
    exporting ? exportModelPricing(props.entry) : ''
  )
  const [mode, setMode] = useState<'json' | 'visual'>('json')
  const [pricing, setPricing] = useState<PricingValues | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const editor = useRef<ModelPricingEditorPanelHandle>(null)
  const save = useSaveModelPricing()
  const editorDirty = useRef(false)
  const trackEditorDirty = useCallback((dirty: boolean) => {
    editorDirty.current = dirty
  }, [])
  const editData = useMemo(
    () => (pricing ? pricingRow(props.entry.model_name, pricing) : null),
    [pricing, props.entry.model_name]
  )
  const baseline = useMemo(
    () => (editData ? pricingFromDraft(editData) : null),
    [editData]
  )

  const readDraft = async () => {
    if (mode === 'json') return parsePricingImport(json)
    const draft = await editor.current?.commitDraft()
    if (!draft || !pricing || !baseline) return null
    if (!editorDirty.current) return pricing
    return mergePricingEditorDraft(pricing, baseline, pricingFromDraft(draft))
  }

  const changeMode = async (next: string) => {
    if (busy || next === mode) return
    setBusy(true)
    setError('')
    try {
      const values = await readDraft()
      if (!values) return
      if (next === 'visual') {
        // Server validation uses the target model's plugin schema and billing
        // engine; a successful parse in the browser is not sufficient.
        await previewModelPricing({
          model_name: props.entry.model_name,
          pricing: values,
        })
        editorDirty.current = false
        setPricing(values)
        setMode('visual')
      } else {
        setJson(JSON.stringify(values, null, 2))
        setMode('json')
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t('Invalid pricing value')
      )
    } finally {
      setBusy(false)
    }
  }

  const persist = async () => {
    setBusy(true)
    setError('')
    try {
      const values = await readDraft()
      if (!values) return
      await save.mutateAsync([
        {
          model_name: props.entry.model_name,
          expected_version: targetEntry.version,
          pricing: values,
        },
      ])
      await props.onSaved()
      toast.success(t('Model pricing saved'))
      props.onClose()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Failed to save model pricing')
      )
      handleServerError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      title={exporting ? t('Export model pricing') : t('Import model pricing')}
      description={
        exporting
          ? t(
              'Copy or download the saved pricing configuration. Built-in billing expressions are included.'
            )
          : t(
              'Import replaces pricing for {{model}} only. Unset fields use this model’s defaults. Review provider overrides and prices before saving.',
              { model: props.entry.model_name }
            )
      }
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose()
      }}
      contentClassName='sm:max-w-4xl'
      footer={
        <>
          <Button variant='outline' disabled={busy} onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          {exporting ? (
            <>
              <CopyButton
                value={json}
                variant='outline'
                size='default'
                aria-label={t('Copy pricing JSON')}
              >
                {t('Copy pricing JSON')}
              </CopyButton>
              <Button
                onClick={() => {
                  if (downloadUrl.current) {
                    URL.revokeObjectURL(downloadUrl.current)
                  }
                  const url = URL.createObjectURL(
                    new Blob([json], { type: 'application/json' })
                  )
                  downloadUrl.current = url
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `${props.entry.model_name.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}-pricing.json`
                  document.body.appendChild(link)
                  link.click()
                  link.remove()
                }}
              >
                {t('Download JSON')}
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || (!pricing && !json.trim())}
              onClick={() => {
                if (pricing) void persist()
                else void changeMode('visual')
              }}
            >
              {busy && t('Loading...')}
              {!busy &&
                (pricing ? t('Save model prices') : t('Preview and edit'))}
            </Button>
          )}
        </>
      }
    >
      <Tabs
        className='min-w-0 gap-4'
        value={mode}
        onValueChange={(value) => void changeMode(value)}
      >
        <TabsList>
          <TabsTrigger value='json' disabled={busy}>
            {t('JSON')}
          </TabsTrigger>
          {!exporting && (
            <TabsTrigger value='visual' disabled={busy || !json.trim()}>
              {t('Preview and edit')}
            </TabsTrigger>
          )}
        </TabsList>

        {error && (
          <Alert variant='destructive'>
            <AlertDescription className='flex flex-col items-start gap-2'>
              <p>{error}</p>
              {save.isError && (
                <>
                  <p>
                    {t(
                      'Reload the target version, review your draft, then save again.'
                    )}
                  </p>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const snapshot = await getModelPricing([
                          props.entry.model_name,
                        ])
                        const loaded = snapshot.entries.find(
                          (item) => item.model_name === props.entry.model_name
                        )
                        if (!loaded) {
                          throw new Error(t('Failed to load model pricing'))
                        }
                        setTargetEntry(loaded)
                        save.reset()
                        setError('')
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : t('Failed to load model pricing')
                        )
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    {t('Reload pricing')}
                  </Button>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        <TabsContent value='json' className='flex min-w-0 flex-col gap-4'>
          {!exporting && (
            <Field>
              <FieldLabel htmlFor={fileId}>{t('Import JSON file')}</FieldLabel>
              <Input
                id={fileId}
                type='file'
                accept='.json,application/json'
                disabled={busy}
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  setBusy(true)
                  setError('')
                  try {
                    if (file.size >= MAX_PRICING_IMPORT_BYTES) {
                      throw new Error(
                        t('Pricing JSON must be smaller than 1 MB')
                      )
                    }
                    setJson(await file.text())
                    setPricing(null)
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : t('Invalid pricing value')
                    )
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </Field>
          )}
          <JsonCodeEditor
            value={json}
            onChange={(value) => {
              setJson(value)
              setError('')
            }}
            disabled={exporting || busy}
            ariaLabel={t('Pricing JSON')}
            heightClassName='h-80 min-h-56 max-h-[50dvh]'
          />
        </TabsContent>
        <TabsContent value='visual'>
          {editData && (
            <div inert={busy} className='flex h-[60dvh] min-h-0 flex-col'>
              <ModelPricingEditorPanel
                ref={editor}
                onDirtyChange={trackEditorDirty}
                embedded
                editData={editData}
                usageSchema={targetEntry.usage_schema}
                pluginVariants={targetEntry.plugin_variants}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
