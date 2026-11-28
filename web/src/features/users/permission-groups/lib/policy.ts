import type { TFunction } from 'i18next'
import { z } from 'zod'

import { formatNumber } from '@/lib/format'

const nonEmptyTrimmed = z
  .string()
  .min(1)
  .refine((val) => val.trim() === val)
const names = z.array(nonEmptyTrimmed)
const members = z.array(z.number().int().positive())
const nonEmptyMembersRecord = z
  .record(nonEmptyTrimmed, members.min(1))
  .optional()
const nonEmptyNamesRecord = z.record(nonEmptyTrimmed, names.min(1)).optional()

const policySchema = z
  .object({
    audiences: z.record(nonEmptyTrimmed, members),
    models: z.record(nonEmptyTrimmed, names),
    groups: z.record(nonEmptyTrimmed, names),
    model_users: nonEmptyMembersRecord,
    group_users: nonEmptyMembersRecord,
    open_models: names.optional(),
    open_groups: names.optional(),
    model_exclusions: nonEmptyMembersRecord,
    group_exclusions: nonEmptyMembersRecord,
    model_excluded_groups: nonEmptyNamesRecord,
    group_excluded_groups: nonEmptyNamesRecord,
  })
  .strict()
  .superRefine((val, ctx) => {
    const checkAudienceRefs = (record?: Record<string, string[]>) => {
      if (!record) return
      for (const refs of Object.values(record)) {
        for (const ref of refs) {
          if (!Object.hasOwn(val.audiences, ref)) {
            ctx.addIssue({
              code: 'custom',
              message: `Unknown permission group: ${ref}`,
            })
          }
        }
      }
    }
    checkAudienceRefs(val.models)
    checkAudienceRefs(val.groups)
    checkAudienceRefs(val.model_excluded_groups)
    checkAudienceRefs(val.group_excluded_groups)
  })

export type Policy = z.infer<typeof policySchema>
export type ResourceKind = 'models' | 'groups'
export type AccessMode = 'inherit' | 'all_users' | 'allowlist' | 'disabled'

export interface ResourceRule {
  mode: AccessMode
  allowedGroups: string[]
  allowedUsers: number[]
  excludedGroups: string[]
  excludedUsers: number[]
}

export const resourceKinds = ['models', 'groups'] as const

export const EMPTY_POLICY: Policy = {
  audiences: {},
  models: {},
  groups: {},
}

const userKeys = {
  models: 'model_users',
  groups: 'group_users',
} as const

const openKeys = {
  models: 'open_models',
  groups: 'open_groups',
} as const

const exclusionKeys = {
  models: 'model_exclusions',
  groups: 'group_exclusions',
} as const

const excludedGroupKeys = {
  models: 'model_excluded_groups',
  groups: 'group_excluded_groups',
} as const

export const groupSchema = z.object({
  name: z.string().trim().min(1),
  members,
  models: z.array(z.string()),
  groups: z.array(z.string()),
})
export type GroupForm = z.infer<typeof groupSchema>

export const ruleFormSchema = z
  .object({
    name: z.string(),
    mode: z.enum(['inherit', 'all_users', 'allowlist', 'disabled']),
    allowedGroups: z.array(z.string()),
    allowedUsers: members,
    excludedGroups: z.array(z.string()),
    excludedUsers: members,
  })
  .refine(
    (rule) =>
      rule.mode !== 'allowlist' ||
      rule.allowedGroups.length > 0 ||
      rule.allowedUsers.length > 0,
    {
      path: ['allowedGroups'],
    }
  )

export type RuleFormValues = z.infer<typeof ruleFormSchema>

function uniqueSortedStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort()
}

function uniqueSortedNumbers(items: number[]): number[] {
  return [...new Set(items.filter((id) => id > 0))].sort((a, b) => a - b)
}

export function parsePolicy(saved?: string): Policy | null {
  try {
    const parsed: unknown = JSON.parse(saved ?? '')
    const result = policySchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function getResourceRule(
  policy: Policy,
  kind: ResourceKind,
  name: string
): ResourceRule {
  const allowGroupsMap = policy[kind]
  const allowUsersMap = policy[userKeys[kind]]
  const openList = policy[openKeys[kind]] ?? []
  const excludedUsersMap = policy[exclusionKeys[kind]]
  const excludedGroupsMap = policy[excludedGroupKeys[kind]]

  const hasGroupAllow = Object.hasOwn(allowGroupsMap, name)
  const hasUserAllow = Boolean(
    allowUsersMap && Object.hasOwn(allowUsersMap, name)
  )
  const allowedGroups = hasGroupAllow ? allowGroupsMap[name] : []
  const allowedUsers = hasUserAllow && allowUsersMap ? allowUsersMap[name] : []
  const excludedUsers =
    excludedUsersMap && Object.hasOwn(excludedUsersMap, name)
      ? excludedUsersMap[name]
      : []
  const excludedGroups =
    excludedGroupsMap && Object.hasOwn(excludedGroupsMap, name)
      ? excludedGroupsMap[name]
      : []

  if (hasGroupAllow || hasUserAllow) {
    const isDisabled = allowedGroups.length === 0 && allowedUsers.length === 0
    return {
      mode: isDisabled ? 'disabled' : 'allowlist',
      allowedGroups,
      allowedUsers,
      excludedGroups,
      excludedUsers,
    }
  }

  if (
    openList.includes(name) ||
    excludedUsers.length > 0 ||
    excludedGroups.length > 0
  ) {
    return {
      mode: 'all_users',
      allowedGroups: [],
      allowedUsers: [],
      excludedGroups,
      excludedUsers,
    }
  }

  return {
    mode: 'inherit',
    allowedGroups: [],
    allowedUsers: [],
    excludedGroups: [],
    excludedUsers: [],
  }
}

export function restrictedResources(
  policy: Policy | null,
  kind: ResourceKind
): Set<string> {
  if (!policy) return new Set()
  return new Set([
    ...Object.keys(policy[kind]),
    ...Object.keys(policy[userKeys[kind]] ?? {}),
    ...(policy[openKeys[kind]] ?? []),
    ...Object.keys(policy[exclusionKeys[kind]] ?? {}),
    ...Object.keys(policy[excludedGroupKeys[kind]] ?? {}),
  ])
}

export function hasResourceRule(
  policy: Policy | null,
  kind: ResourceKind,
  name: string
): boolean {
  return restrictedResources(policy, kind).has(name)
}

export function applyResourceRule(
  policy: Policy,
  kind: ResourceKind,
  targetNames: string[],
  rule: ResourceRule
): Policy {
  const targets = uniqueSortedStrings(targetNames)
  if (targets.length === 0) return policy

  const nextAllowGroups = { ...policy[kind] }
  const uKey = userKeys[kind]
  const nextAllowUsers = { ...policy[uKey] }
  const oKey = openKeys[kind]
  const nextOpenSet = new Set(policy[oKey] ?? [])
  const eKey = exclusionKeys[kind]
  const nextExcludedUsers = { ...policy[eKey] }
  const egKey = excludedGroupKeys[kind]
  const nextExcludedGroups = { ...policy[egKey] }

  const cleanAllowedGroups = uniqueSortedStrings(rule.allowedGroups)
  const cleanAllowedUsers = uniqueSortedNumbers(rule.allowedUsers)
  const cleanExcludedGroups = uniqueSortedStrings(rule.excludedGroups)
  const cleanExcludedUsers = uniqueSortedNumbers(rule.excludedUsers)

  for (const name of targets) {
    delete nextAllowGroups[name]
    delete nextAllowUsers[name]
    nextOpenSet.delete(name)
    delete nextExcludedUsers[name]
    delete nextExcludedGroups[name]

    if (rule.mode === 'disabled') {
      nextAllowGroups[name] = []
      continue
    }

    if (rule.mode === 'all_users') {
      nextOpenSet.add(name)
      if (cleanExcludedUsers.length > 0) {
        nextExcludedUsers[name] = cleanExcludedUsers
      }
      if (cleanExcludedGroups.length > 0) {
        nextExcludedGroups[name] = cleanExcludedGroups
      }
      continue
    }

    if (rule.mode === 'allowlist') {
      if (cleanAllowedGroups.length > 0) {
        nextAllowGroups[name] = cleanAllowedGroups
      }
      if (cleanAllowedUsers.length > 0) {
        nextAllowUsers[name] = cleanAllowedUsers
      }
      if (cleanExcludedUsers.length > 0) {
        nextExcludedUsers[name] = cleanExcludedUsers
      }
      if (cleanExcludedGroups.length > 0) {
        nextExcludedGroups[name] = cleanExcludedGroups
      }
    }
  }

  const next: Policy = {
    ...policy,
    [kind]: nextAllowGroups,
  }

  if (Object.keys(nextAllowUsers).length > 0) next[uKey] = nextAllowUsers
  else delete next[uKey]

  const sortedOpen = [...nextOpenSet].sort()
  if (sortedOpen.length > 0) next[oKey] = sortedOpen
  else delete next[oKey]

  if (Object.keys(nextExcludedUsers).length > 0) next[eKey] = nextExcludedUsers
  else delete next[eKey]

  if (Object.keys(nextExcludedGroups).length > 0) {
    next[egKey] = nextExcludedGroups
  } else {
    delete next[egKey]
  }

  return next
}

export function clearResourceRules(
  policy: Policy,
  kind: ResourceKind,
  targetNames: string[]
): Policy {
  return applyResourceRule(policy, kind, targetNames, {
    mode: 'inherit',
    allowedGroups: [],
    allowedUsers: [],
    excludedGroups: [],
    excludedUsers: [],
  })
}

export function groupResources(
  name: string | undefined,
  ...ruleMaps: (Record<string, string[]> | undefined)[]
): string[] {
  if (name === undefined) return []
  const targets = new Set<string>()
  for (const rules of ruleMaps) {
    for (const [target, groups] of Object.entries(rules ?? {})) {
      if (groups.includes(name)) targets.add(target)
    }
  }
  return [...targets]
}

export function orphanedResourcesOnGroupDelete(
  policy: Policy,
  groupName: string
): { models: string[]; groups: string[] } {
  const result: { models: string[]; groups: string[] } = {
    models: [],
    groups: [],
  }
  for (const kind of resourceKinds) {
    const allowUsersMap = policy[userKeys[kind]]
    for (const [target, groups] of Object.entries(policy[kind])) {
      if (!groups.includes(groupName)) continue
      const remainingGroups = groups.filter((item) => item !== groupName)
      const directUsers =
        allowUsersMap && Object.hasOwn(allowUsersMap, target)
          ? allowUsersMap[target]
          : []
      if (remainingGroups.length === 0 && directUsers.length === 0) {
        result[kind].push(target)
      }
    }
    result[kind].sort()
  }
  return result
}

export function changeGroup(
  policy: Policy,
  previous?: string,
  group?: GroupForm,
  clearOrphaned = false
): Policy {
  const audiences = { ...policy.audiences }
  if (previous !== undefined) delete audiences[previous]
  const next: Policy = {
    ...policy,
    audiences: group
      ? { ...audiences, [group.name]: uniqueSortedNumbers(group.members) }
      : audiences,
  }

  for (const kind of resourceKinds) {
    const selected = new Set(group?.[kind])
    const targets = new Set([...Object.keys(policy[kind]), ...selected])
    const allowUsersMap = policy[userKeys[kind]]
    const updatedAllow: Record<string, string[]> = {}
    const nextOpenSet = new Set(policy[openKeys[kind]] ?? [])

    for (const target of targets) {
      const current = Object.hasOwn(policy[kind], target)
        ? policy[kind][target]
        : []
      const hadPrevious = previous !== undefined && current.includes(previous)
      const remaining = current.filter((name) => name !== previous)
      if (group && selected.has(target)) {
        remaining.push(group.name)
        nextOpenSet.delete(target)
      }
      const directUsers =
        allowUsersMap && Object.hasOwn(allowUsersMap, target)
          ? allowUsersMap[target]
          : []
      if (
        !group &&
        clearOrphaned &&
        hadPrevious &&
        remaining.length === 0 &&
        directUsers.length === 0
      ) {
        continue
      }
      if (remaining.length === 0 && directUsers.length > 0) {
        continue
      }
      updatedAllow[target] = uniqueSortedStrings(remaining)
    }
    next[kind] = updatedAllow

    const sortedOpen = [...nextOpenSet].sort()
    const oKey = openKeys[kind]
    if (sortedOpen.length > 0) next[oKey] = sortedOpen
    else delete next[oKey]

    if (previous !== undefined) {
      const egKey = excludedGroupKeys[kind]
      const existingExcluded = policy[egKey]
      if (existingExcluded) {
        const cleanedExcluded: Record<string, string[]> = {}
        for (const [target, groups] of Object.entries(existingExcluded)) {
          const updated = groups
            .map((item) => (item === previous && group ? group.name : item))
            .filter((item) => group !== undefined || item !== previous)
          const unique = uniqueSortedStrings(updated)
          if (unique.length > 0) {
            cleanedExcluded[target] = unique
          }
        }
        if (Object.keys(cleanedExcluded).length > 0) {
          next[egKey] = cleanedExcluded
        } else {
          delete next[egKey]
        }
      }
    }
  }

  return next
}

export function nameOptions(
  items: string[]
): Array<{ label: string; value: string }> {
  return [...new Set(items)].sort().map((value) => ({ label: value, value }))
}

export function describeResourceRule(
  rule: ResourceRule,
  t: TFunction,
  locale?: string
): string {
  if (rule.mode === 'inherit') {
    return t('Follows default routing group access')
  }
  if (rule.mode === 'disabled') {
    return t('Hidden from all users and blocked from API calls')
  }

  const parts: string[] = []
  if (rule.mode === 'all_users') {
    parts.push(t('Visible by default to logged-in users'))
  } else {
    const allowParts: string[] = []
    if (rule.allowedGroups.length > 0) {
      allowParts.push(rule.allowedGroups.join(' · '))
    }
    if (rule.allowedUsers.length > 0) {
      allowParts.push(
        t('Allowed accounts: {{total}}', {
          total: formatNumber(rule.allowedUsers.length, locale),
        })
      )
    }
    parts.push(allowParts.join(' · '))
  }

  if (rule.excludedGroups.length > 0) {
    parts.push(
      t('Excluded groups: {{groups}}', {
        groups: rule.excludedGroups.join(', '),
      })
    )
  }
  if (rule.excludedUsers.length > 0) {
    parts.push(
      t('Excluded accounts: {{total}}', {
        total: formatNumber(rule.excludedUsers.length, locale),
      })
    )
  }

  return parts.join(' · ')
}
