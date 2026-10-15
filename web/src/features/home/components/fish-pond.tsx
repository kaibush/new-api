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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

function SwimmingFish(props: {
  color: 'green' | 'blue' | 'pink'
  label: string
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [playing, setPlaying] = useState(false)
  return (
    <Button
      variant='ghost'
      className={`mofish-fish mofish-fish-${props.color}`}
      aria-label={props.label}
      aria-pressed={playing}
      data-swimming={hovered || focused || playing}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={() => setPlaying(!playing)}
    >
      <span className='mofish-swimmer'>
        <svg
          className='size-full'
          viewBox='0 0 220 120'
          fill='none'
          aria-hidden='true'
        >
          <path d='M58 59 7 29 17 110 62 73Z' fill='currentColor' />
          <path
            d='M55 67C71-5 156 0 213 51 169 111 90 136 55 67Z'
            fill='currentColor'
          />
          <path
            d='m117 61 34 32c-18 13-33 15-48 3Z'
            fill='white'
            opacity='.25'
          />
          <path
            d='M160 49q8-14 16-2m3 20q8 7 15-1'
            stroke='white'
            strokeWidth='4'
            strokeLinecap='round'
          />
        </svg>
      </span>
    </Button>
  )
}

export function FishPond() {
  const { t } = useTranslation()
  return (
    <div className='mofish-pond'>
      <svg
        viewBox='0 0 520 240'
        className='absolute inset-0 size-full'
        fill='none'
        aria-hidden='true'
      >
        <circle cx='424' cy='52' r='28' fill='#f6c85f' />
        <path
          d='M424 14V8m0 88v-6m38-38h6m-79 0h-6m69-28 5-5'
          stroke='#f6c85f'
          strokeWidth='3'
          strokeLinecap='round'
        />
        <circle cx='33' cy='54' r='5' fill='#c4dcf7' />
        <circle cx='282' cy='108' r='6' stroke='#89c5b7' strokeWidth='2' />
        <circle cx='294' cy='86' r='3' fill='#a7d5c8' />
        <path
          d='M484 108v12m-6-6h12'
          stroke='#c4487e'
          strokeWidth='2'
          strokeLinecap='round'
        />
        <path
          d='M232 171v12m-6-6h12'
          stroke='#bc6719'
          strokeWidth='2'
          strokeLinecap='round'
        />
        <g className='mofish-waves' strokeWidth='2'>
          <path d='M8 205c65-25 103 32 173 4s111-21 173-1 95 20 156-5' />
          <path d='M44 225c45-14 68 13 115 3m191 6c45-16 70 15 112-2' />
        </g>
      </svg>
      <SwimmingFish color='green' label={t('Swim with the green fish')} />
      <SwimmingFish color='blue' label={t('Swim with the blue fish')} />
      <SwimmingFish color='pink' label={t('Swim with the pink fish')} />
    </div>
  )
}
