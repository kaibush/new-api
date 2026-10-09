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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { helpCenterSchema } from './config'
import { HelpContent } from './help-content'

export function HelpCenter() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState('')
  const query = useQuery({
    queryKey: ['help-center'],
    queryFn: async () => {
      const response = requireServerSuccess(
        (await api.get('/api/help-center')).data
      )
      return helpCenterSchema.parse(response.data)
    },
  })
  const items = query.data?.items.filter((item) => item.enabled) ?? []
  const active = items.some((item) => item.id === selected)
    ? selected
    : items[0]?.id
  let content = <EmptyState title={t('No help content yet')} />
  if (query.isPending) content = <LoadingState />
  else if (query.isError) {
    content = <ErrorState onRetry={() => void query.refetch()} />
  } else if (items.length) {
    content = (
      <Tabs
        value={active}
        onValueChange={(value) => setSelected(String(value))}
      >
        <div className='max-w-full overflow-x-auto pb-2'>
          <TabsList aria-label={t('Help Center')}>
            {items.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className='max-w-72 truncate px-4'
                title={item.title}
              >
                {item.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {items.map((item) => (
          <TabsContent
            key={item.id}
            value={item.id}
            className='min-w-0 rounded-xl border p-4 sm:p-6'
          >
            {active === item.id && <HelpContent item={item} />}
          </TabsContent>
        ))}
      </Tabs>
    )
  }
  return (
    <PublicLayout>
      <div className='mx-auto w-full max-w-6xl space-y-6 px-4 py-8'>
        <h1 className='text-2xl font-semibold'>{t('Help Center')}</h1>
        {content}
      </div>
    </PublicLayout>
  )
}
