import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { EmptyState } from '@/components/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber } from '@/lib/format'

export function StatusTrend(props: {
  title: string
  data: { start: string }[]
  fields: { key: string; label: string }[]
}) {
  const { i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const config = Object.fromEntries(
    props.fields.map((field, index) => [
      field.key,
      { label: field.label, color: `var(--chart-${index + 1})` },
    ])
  )
  return (
    <Card className='min-w-0'>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {props.data.length === 0 ? (
          <EmptyState />
        ) : (
          <ChartContainer
            config={config}
            className='h-64 w-full'
            aria-label={props.title}
          >
            <LineChart data={props.data} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey='start'
                minTickGap={35}
                tickFormatter={(value: string) =>
                  new Date(value).toLocaleString(locale, {
                    timeZone: 'Asia/Shanghai',
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                  })
                }
              />
              <YAxis
                tickFormatter={(value: number) =>
                  formatCompactNumber(value, locale)
                }
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {props.fields.map((field) => (
                <Line
                  key={field.key}
                  type='monotone'
                  dataKey={field.key}
                  stroke={`var(--color-${field.key})`}
                  dot={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function StatusMetrics(props: { items: (readonly [string, string])[] }) {
  return (
    <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
      {props.items.map(([label, value]) => (
        <Card key={label}>
          <CardContent className='pt-5'>
            <p className='text-muted-foreground text-sm'>{label}</p>
            <p className='mt-1 text-xl font-semibold break-words tabular-nums'>
              {value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
