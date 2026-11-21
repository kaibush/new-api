import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'

import { refreshForRelease, useFrontendRelease } from './store'

export function FrontendRefreshDialog() {
  const { t } = useTranslation()
  const release = useFrontendRelease((state) => state.release)
  const dismissed = useFrontendRelease((state) => state.dismissed)
  const dismiss = useFrontendRelease((state) => state.dismiss)
  return (
    <ConfirmDialog
      open={Boolean(release && release.revision > dismissed)}
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
      title={t('A new version is available')}
      desc={
        <div className='space-y-3'>
          <p className='break-all'>{release?.version}</p>
          {release?.notes && (
            <p className='max-h-60 overflow-auto break-words whitespace-pre-wrap'>
              {release.notes}
            </p>
          )}
          <p>
            {t('Save your work before refreshing to load the latest version.')}
          </p>
        </div>
      }
      confirmText={t('Refresh now')}
      cancelBtnText={t('Later')}
      handleConfirm={() => {
        if (release) refreshForRelease(release.revision)
      }}
    />
  )
}
