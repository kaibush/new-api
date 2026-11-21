import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { boardRoutes, type BoardDocument } from './schema'

export function BoardActionsEditor(props: {
  form: UseFormReturn<BoardDocument>
  index: number
}) {
  const { t } = useTranslation()
  const actions = useFieldArray({
    control: props.form.control,
    name: `blocks.${props.index}.actions`,
    keyName: 'fieldKey',
  })
  const values = props.form.watch(`blocks.${props.index}.actions`)
  return (
    <>
      {actions.fields.map((action, ai) => (
        <div key={action.fieldKey} className='space-y-2 rounded-md border p-3'>
          <NativeSelect
            aria-label={t('Action type')}
            {...props.form.register(`blocks.${props.index}.actions.${ai}.type`)}
          >
            <NativeSelectOption value='external_url'>
              {t('External URL')}
            </NativeSelectOption>
            <NativeSelectOption value='internal_route'>
              {t('Internal route')}
            </NativeSelectOption>
            <NativeSelectOption value='modal_content'>
              {t('Content dialog')}
            </NativeSelectOption>
            <NativeSelectOption value='modal_widget'>
              {t('Built-in dialog')}
            </NativeSelectOption>
            <NativeSelectOption value='chat_prefill'>
              {t('Insert into chat')}
            </NativeSelectOption>
            <NativeSelectOption value='copy_text'>
              {t('Copy text')}
            </NativeSelectOption>
          </NativeSelect>
          {values[ai].type === 'external_url' && (
            <Controller
              control={props.form.control}
              name={`blocks.${props.index}.actions.${ai}.confirm_leave`}
              render={({ field }) => (
                <label className='flex items-center gap-2'>
                  <Switch
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                  <span>{t('Confirm before opening')}</span>
                </label>
              )}
            />
          )}
          <label className='block space-y-1'>
            <span>{t('Button text')}</span>
            <Input
              {...props.form.register(
                `blocks.${props.index}.actions.${ai}.label`
              )}
              maxLength={120}
            />
          </label>
          <label className='block space-y-1'>
            <span>{t('Action value')}</span>
            {values[ai].type === 'modal_widget' ? (
              <NativeSelect
                {...props.form.register(
                  `blocks.${props.index}.actions.${ai}.value`
                )}
              >
                <NativeSelectOption value=''>{t('Select')}</NativeSelectOption>
                <NativeSelectOption value='checkin'>
                  {t('Daily Check-in')}
                </NativeSelectOption>
                <NativeSelectOption value='checkin_leaderboard'>
                  {t('Check-in leaderboard')}
                </NativeSelectOption>
              </NativeSelect>
            ) : null}
            {values[ai].type === 'internal_route' ? (
              <NativeSelect
                {...props.form.register(
                  `blocks.${props.index}.actions.${ai}.value`
                )}
              >
                <NativeSelectOption value=''>{t('Select')}</NativeSelectOption>
                {boardRoutes.map((route) => (
                  <NativeSelectOption key={route} value={route}>
                    {route}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
            {!['modal_widget', 'internal_route'].includes(values[ai].type) && (
              <Textarea
                {...props.form.register(
                  `blocks.${props.index}.actions.${ai}.value`
                )}
                maxLength={12000}
                aria-invalid={
                  !!props.form.formState.errors.blocks?.[props.index]
                    ?.actions?.[ai]
                }
              />
            )}
          </label>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => actions.remove(ai)}
          >
            {t('Remove')}
          </Button>
        </div>
      ))}
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={actions.fields.length >= 12}
        onClick={() =>
          actions.append({ type: 'external_url', label: '', value: '' })
        }
      >
        {t('Add action')}
      </Button>
    </>
  )
}
