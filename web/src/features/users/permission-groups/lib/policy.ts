import { z } from 'zod'

const names = z.array(z.string())
const members = z.array(z.number().int().positive())
const policySchema = z
  .object({
    audiences: z.record(z.string(), members),
    models: z.record(z.string(), names),
    groups: z.record(z.string(), names),
  })
  .strict()

export type Policy = z.infer<typeof policySchema>
export type ResourceKind = 'models' | 'groups'
export const resourceKinds = ['models', 'groups'] as const
export const groupSchema = z.object({
  name: z.string().trim().min(1),
  members,
  models: names,
  groups: names,
})
export type GroupForm = z.infer<typeof groupSchema>
export const ruleSchema = z.object({ name: z.string().min(1), allowed: names })

export function parsePolicy(saved?: string): Policy | null {
  try {
    const parsed: unknown = JSON.parse(saved ?? '')
    return policySchema.safeParse(parsed).success ? (parsed as Policy) : null
  } catch {
    return null
  }
}

export function groupResources(rules: Policy['models'], name?: string) {
  return Object.keys(rules).filter(
    (target) => name !== undefined && rules[target].includes(name)
  )
}

export function changeGroup(
  policy: Policy,
  previous?: string,
  group?: GroupForm
): Policy {
  const audiences = { ...policy.audiences }
  if (previous !== undefined) delete audiences[previous]
  const next = {
    ...policy,
    audiences: group
      ? { ...audiences, [group.name]: group.members }
      : audiences,
  }
  for (const kind of resourceKinds) {
    const selected = new Set(group?.[kind])
    const targets = new Set([...Object.keys(policy[kind]), ...selected])
    next[kind] = Object.fromEntries(
      [...targets].map((target) => {
        const allowed = Object.hasOwn(policy[kind], target)
          ? policy[kind][target]
          : []
        const remaining = allowed.filter((name) => name !== previous)
        if (group && selected.has(target)) remaining.push(group.name)
        return [target, remaining]
      })
    )
  }
  return next
}

export function nameOptions(names: string[]) {
  return [...new Set(names)].sort().map((value) => ({ label: value, value }))
}
