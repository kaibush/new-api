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
export interface CheckinEligibility {
  mode?: number
  expiry_seconds?: number
  limited: boolean
  allowed: boolean
  reasons: string[]
  min_quota: number
  max_quota: number
  base_min_quota: number
  base_max_quota: number
  reward_percent: number
  activity_percent: number
  reward_numerator: number
  reward_denominator: number
  gift_remaining: number
  gift_cap: number
  monthly_awarded: number
  monthly_cap: number
  monthly_remaining: number
  recent_spend: number
  minimum_spend: number
  spending_gap: number
  activity_days: number
  observation_until: number
  next_month_at: number
  today: string
  coverage_since: number
  history_complete: boolean
  window_start: number
  as_of: number
  config_version: number
  new_user_days: number
  grace_day: number
  grace_remaining_days: number
  pending_count: number
}

export interface CheckinSettings {
  mode?: number
  expiry_seconds?: number
  enabled: boolean
  min_quota: number
  max_quota: number
  limits: {
    enabled: boolean
    monthly_cap: number
    activity_days: number
    minimum_spend: number
    reduced_percent: number
    new_user_days: number
  }
}

export interface CheckinConfiguration {
  settings: CheckinSettings
  version: number
  observed_since: number
}

export interface CheckinUser {
  id: number
  username: string
  display_name: string
  created_at: number
  eligibility: CheckinEligibility
}

export interface CheckinUserQuery {
  page: number
  page_size: number
  search: string
  filter: string
  sort: string
  preview?: CheckinSettings
}

export interface CheckinUserPage {
  mode?: number
  items: CheckinUser[]
  total: number
  as_of: number
  config_version: number
  updating: boolean
  preview: boolean
}

export interface CheckinDay {
  day: number
  quota: number
}

export interface CheckinOverview {
  as_of: number
  config_version: number
  updating: boolean
  total: number
  grace: number
  active: number
  low_activity: number
  zero_activity: number
  incomplete: number
  pending: number
  distribution: Array<{ label: string; count: number }>
  days: CheckinDay[]
}

export interface CheckinUserDetail {
  grants?: CheckinGrantSummary
  user: CheckinUser
  days: CheckinDay[]
  records: Array<{
    checkin_date: string
    quota_awarded: number
    snapshot: {
      configuration: CheckinConfiguration
      eligibility: CheckinEligibility
      base_quota: number
    } | null
  }>
}

export interface CheckinGrantStatus {
  checkin_id: number
  quota: number
  available: number
  reserved: number
  used: number
  expired: number
  created_at: number
  expires_at: number
}

export interface CheckinGrantSummary {
  available: number
  reserved: number
  used: number
  expired: number
  as_of: number
  // Older servers return null when the user has not claimed any rewards.
  records: CheckinGrantStatus[] | null
}
