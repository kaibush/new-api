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
import { useUserName } from '@/hooks/use-user-name'

export function UserIdentity(props: { userId: number; username?: string }) {
  const username = useUserName(props.userId, props.username)
  if (!Number.isSafeInteger(props.userId) || props.userId <= 0) return <>-</>
  const label = username ? `${username} (#${props.userId})` : `#${props.userId}`
  return (
    <span
      className='inline-block max-w-full min-w-0 truncate align-middle'
      title={label}
    >
      {label}
    </span>
  )
}
