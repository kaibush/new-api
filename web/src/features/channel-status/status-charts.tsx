import { Activity01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

type StatusIcon = ComponentProps<typeof HugeiconsIcon>['icon']

export function StatusPanel(props: {
  title: string
  description?: string
  icon?: StatusIcon
  tone?: string
  children: ReactNode
}) {
  return (
    <Card className='h-full min-w-0'>
      <CardHeader className='flex flex-row items-center gap-3 border-b'>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full bg-current/10',
            props.tone ?? 'text-primary'
          )}
        >
          <HugeiconsIcon
            icon={props.icon ?? Activity01Icon}
            size={18}
            aria-hidden='true'
          />
        </span>
        <div className='min-w-0'>
          <CardTitle>{props.title}</CardTitle>
          {props.description && (
            <CardDescription className='mt-1'>
              {props.description}
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  )
}

export function StatusMetric(props: {
  label: string
  value: string
  detail: ReactNode
  icon: StatusIcon
  color: string
  series?: { value: number | null }[]
}) {
  const gradient = useId().replaceAll(':', '')
  return (
    <Card className='min-w-0'>
      <CardContent className='flex flex-col gap-4'>
        <div className='text-muted-foreground flex items-center gap-2 text-sm'>
          <span
            className='flex size-9 items-center justify-center rounded-full'
            style={{
              color: props.color,
              backgroundColor: `color-mix(in srgb, ${props.color} 12%, transparent)`,
            }}
          >
            <HugeiconsIcon icon={props.icon} size={18} aria-hidden='true' />
          </span>
          {props.label}
        </div>
        <div>
          <p className='text-3xl font-semibold break-words tabular-nums'>
            {props.value}
          </p>
          <div className='text-muted-foreground mt-2 text-xs'>
            {props.detail}
          </div>
        </div>
        {props.series && (
          <ChartContainer
            config={{ value: { color: props.color } }}
            className='h-10 w-full'
            aria-hidden='true'
          >
            <AreaChart
              data={props.series}
              margin={{ top: 3, bottom: 0, left: 0, right: 0 }}
            >
              <defs>
                <linearGradient id={gradient} x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0%' stopColor={props.color} stopOpacity={0.3} />
                  <stop offset='100%' stopColor={props.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
              <Area
                dataKey='value'
                type='linear'
                stroke={props.color}
                fill={`url(#${gradient})`}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function StatusTrend(props: {
  title: string
  description?: string
  data: { start: string }[]
  fields: {
    key: string
    label: string
    color: string
    kind: 'line' | 'area' | 'bar'
  }[]
  health?: boolean
}) {
  const { i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [hidden, setHidden] = useState<string[]>([])
  const visibleFields = props.fields.filter(
    (field) => !hidden.includes(field.key)
  )
  const config = Object.fromEntries(
    props.fields.map((field) => [
      field.key,
      { label: field.label, color: field.color },
    ])
  )
  return (
    <StatusPanel title={props.title} description={props.description}>
      {props.data.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ChartContainer
            config={config}
            className='h-64 w-full'
            aria-label={props.title}
          >
            <ComposedChart
              data={props.data}
              accessibilityLayer
              margin={{ top: 10, right: 4, left: 4, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray='3 3' />
              <XAxis
                dataKey='start'
                minTickGap={25}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: string) =>
                  new Date(value).toLocaleString(locale, {
                    timeZone: 'Asia/Shanghai',
                    ...(props.health
                      ? {}
                      : { month: 'numeric', day: 'numeric' }),
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                }
              />
              {props.health ? (
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                />
              ) : (
                props.fields.map((field) => (
                  <YAxis
                    key={field.key}
                    width={64}
                    interval={0}
                    yAxisId={field.key}
                    hide={
                      visibleFields.indexOf(field) > 1 ||
                      hidden.includes(field.key)
                    }
                    orientation={
                      visibleFields.indexOf(field) === 1 ? 'right' : 'left'
                    }
                    tickLine={false}
                    axisLine={false}
                    tick={(tick) => (
                      <text
                        x={tick.x}
                        y={tick.y}
                        dy={4}
                        textAnchor={
                          visibleFields.indexOf(field) === 1 ? 'start' : 'end'
                        }
                        fill='var(--muted-foreground)'
                        fontSize={11}
                      >
                        {formatCompactNumber(
                          Number(tick.payload.value),
                          locale
                        )}
                      </text>
                    )}
                  />
                ))
              )}
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      new Date(String(value)).toLocaleString(locale, {
                        timeZone: 'Asia/Shanghai',
                      })
                    }
                  />
                }
              />
              {props.health && <ChartLegend content={<ChartLegendContent />} />}
              {props.fields.map((field) => {
                const common = {
                  dataKey: field.key,
                  yAxisId: props.health ? 0 : field.key,
                  hide: hidden.includes(field.key),
                  isAnimationActive: false,
                }
                if (field.kind === 'bar') {
                  return (
                    <Bar
                      key={field.key}
                      {...common}
                      stackId={props.health ? 'requests' : undefined}
                      fill={field.color}
                      maxBarSize={28}
                      radius={[2, 2, 0, 0]}
                    />
                  )
                }
                if (field.kind === 'area') {
                  return (
                    <Area
                      key={field.key}
                      {...common}
                      type='monotone'
                      stroke={field.color}
                      fill={field.color}
                      fillOpacity={0.12}
                      dot={false}
                    />
                  )
                }
                return (
                  <Line
                    key={field.key}
                    {...common}
                    type='monotone'
                    stroke={field.color}
                    strokeDasharray='5 4'
                    dot={false}
                  />
                )
              })}
            </ComposedChart>
          </ChartContainer>
          {!props.health && (
            <div className='mt-3 flex flex-wrap justify-center gap-2'>
              {props.fields.map((field) => (
                <Button
                  key={field.key}
                  variant='ghost'
                  size='sm'
                  aria-pressed={!hidden.includes(field.key)}
                  onClick={() =>
                    setHidden((current) =>
                      current.includes(field.key)
                        ? current.filter((key) => key !== field.key)
                        : [...current, field.key]
                    )
                  }
                  className={cn(
                    'text-xs',
                    hidden.includes(field.key) && 'opacity-40'
                  )}
                >
                  <span
                    className='size-2 rounded-sm'
                    style={{ backgroundColor: field.color }}
                  />
                  {field.label}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </StatusPanel>
  )
}
