import { useAuthStore } from '@/stores/auth-store'

export function useCatalogQueryKey(key: readonly unknown[]) {
  const viewer = useAuthStore((state) => state.auth.user)
  return viewer ? [...key, viewer.id, viewer.group] : key
}
