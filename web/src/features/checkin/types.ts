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
  pool: CheckinPoolSetting
}

export interface CheckinPoolSetting {
  reward_mode: 'uniform' | 'tiered'
  timezone: string
  stats_retention_days: number
  tiers: Array<{
    key: string
    name: string
    min_quota: number
    max_quota: number
    weight_bps: number
    daily_max_count: number
  }>
  time_slots_enabled: boolean
  default_slot_quota_bps: number
  time_slots: Array<{
    key: string
    name: string
    start_minute: number
    end_minute: number
    quota_bps: number
    override_tiers: boolean
    tier_weights: Array<{ tier_key: string; weight_bps: number }>
  }>
  daily_pool: { enabled: boolean; daily_bonus_cap: number }
  leaderboard: {
    enabled: boolean
    top_n: number
    mask_username: boolean
    show_my_rank: boolean
    show_recent_jackpots: boolean
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
  balance?: CheckinUserBalance
}

export interface CheckinUserBalance {
  wallet_quota: number
  checkin_quota: number
  expired_quota: number
  next_expiry_at: number
  as_of: number
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

export interface CheckinLeaderboardEntry {
  rank: number
  username: string
  display_name: string
  quota_awarded: number
  tier_name: string
  checkin_date: string
}
export interface CheckinLeaderboard {
  enabled: boolean
  today?: string
  timezone?: string
  retention_days?: number
  top_n?: number
  today_checkins?: number
  yesterday_checkins?: number
  today_peak_hour?: number
  today_peak_hour_checkins?: number
  recent_participants?: number
  recent_checkins?: number
  top?: CheckinLeaderboardEntry[]
  recent_highlights?: CheckinLeaderboardEntry[]
  recent_totals?: CheckinLeaderboardEntry[]
  my_rank?: number
  my_quota?: number
  surpassed_bps?: number
}
export interface CheckinAnalyticsBucket {
  bucket_key: string
  bucket_label: string
  checkin_count: number
  total_quota: number
  max_award_quota: number
}
export interface CheckinAnalytics {
  timezone: string
  today: string
  retention_days: number
  reward_mode: string
  configured_tiers: CheckinPoolSetting['tiers']
  daily_pool: CheckinPoolSetting['daily_pool']
  today_pool_used: number
  daily_series: Array<{
    date: string
    total_checkins: number
    total_quota: number
    fallback_count: number
    tiers: CheckinAnalyticsBucket[]
    slots: CheckinAnalyticsBucket[]
    hours: CheckinAnalyticsBucket[]
  }>
}
