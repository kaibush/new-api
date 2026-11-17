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
import { useTranslation } from 'react-i18next'

export function useInputAuditCaseLabels() {
  const { t } = useTranslation()
  return {
    statuses: {
      pending: t('Pending review'),
      insufficient_evidence: t('Insufficient evidence'),
      confirmed: t('Confirmed violation'),
      dismissed: t('False positive'),
      appeal_review: t('Reopened review'),
    },
    categories: {
      fraud: t('Fraud'),
      cyber_abuse: t('Cyber abuse'),
      sexual: t('Sexual content'),
      dangerous_materials: t('Dangerous materials'),
      self_harm: t('Self-harm'),
      prompt_injection: t('Prompt injection'),
      other: t('Other'),
    },
  }
}

export function useModelReviewLabels() {
  const { t } = useTranslation()
  return {
    safe: t('No risk identified'),
    review: t('Needs human review'),
    insufficient_evidence: t('Insufficient evidence'),
    failed: t('Failed'),
    pending: t('Pending'),
    running: t('Running'),
    completed: t('Completed'),
    cancelled: t('Cancelled'),
  } as Record<string, string>
}
