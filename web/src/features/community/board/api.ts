import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { boardSchema, normalizeBoard, type BoardDocument } from './schema'

export async function getBoard(admin = false): Promise<BoardDocument> {
  const response = await api.get<{ success: boolean; data: BoardDocument }>(
    admin ? '/api/option/community/board' : '/api/community/board'
  )
  return normalizeBoard(
    boardSchema.parse(requireServerSuccess(response.data).data)
  )
}
export async function saveBoard(
  document: BoardDocument
): Promise<BoardDocument> {
  const response = await api.put<{ success: boolean; data: BoardDocument }>(
    '/api/option/community/board',
    document
  )
  return normalizeBoard(
    boardSchema.parse(requireServerSuccess(response.data).data)
  )
}
