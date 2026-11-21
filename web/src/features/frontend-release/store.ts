import { create } from 'zustand'

export type FrontendRelease = {
  revision: number
  version: string
  notes: string
  published_at: number
}

function documentRevision(): number {
  if (typeof document === 'undefined') return 0
  const stamped = document.querySelector<HTMLMetaElement>(
    'meta[name="frontend-release"]'
  )
  if (stamped) return Number(stamped.content) || 0
  // Also support separately hosted frontends which do not receive the HTML stamp.
  try {
    return Number(sessionStorage.getItem('frontend-release:refreshed')) || 0
  } catch {
    return 0
  }
}

const baseline = documentRevision()
export const useFrontendRelease = create<{
  release: FrontendRelease | null
  dismissed: number
  receive: (release: FrontendRelease) => void
  dismiss: () => void
}>((set) => ({
  release: null,
  dismissed: baseline,
  receive: (release) =>
    set((state) => {
      if (
        !Number.isSafeInteger(release.revision) ||
        release.revision <= baseline ||
        release.revision <= (state.release?.revision ?? 0)
      ) {
        return state
      }
      return { release }
    }),
  dismiss: () =>
    set((state) => ({ dismissed: state.release?.revision ?? state.dismissed })),
}))

export function refreshForRelease(revision: number) {
  try {
    sessionStorage.setItem('frontend-release:refreshed', String(revision))
  } catch {
    /* Storage can be disabled. */
  }
  window.location.reload()
}
