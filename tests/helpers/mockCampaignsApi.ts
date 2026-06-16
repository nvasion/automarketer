/**
 * Test helper: emulate the server campaigns + ai-prefs API on top of the
 * localStorage-backed CampaignModel.
 *
 * Campaigns moved from localStorage to a server endpoint, but many UI/hook
 * tests seed data via `CampaignModel.create()` / `seed()` and expect it to flow
 * through the hooks. Installing this fetch mock lets those tests keep seeding
 * via CampaignModel while the server-backed client reads/writes through it.
 *
 * Also sets the migration flag so the one-time localStorage → server migration
 * is skipped (the data is already "on the server" in this emulation).
 */
import { vi } from 'vitest'
import { CampaignModel } from '../../src/db/CampaignModel'
import type { CampaignRecord, CreateCampaignInput, UpdateCampaignInput } from '../../src/db/schema'

const MIGRATED_FLAG = 'automarketer_campaigns_migrated'
const CAMPAIGNS_KEY = 'automarketer_campaigns'

function res(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body ?? null,
  } as unknown as Response
}

/** Install the fetch mock. Call in a test's beforeEach (after localStorage.clear()). */
export function installMockCampaignsApi(): void {
  localStorage.setItem(MIGRATED_FLAG, 'true')

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      const path = url.split('?')[0]
      const method = (init?.method ?? 'GET').toUpperCase()
      const parseBody = <T>(): T => JSON.parse((init?.body as string) ?? '{}') as T

      // AI prefs — minimal stub: nothing stored, accept writes.
      if (path === '/api/ai-prefs') {
        return method === 'PUT' ? res(200, parseBody()) : res(200, null)
      }

      if (path === '/api/campaigns/import' && method === 'POST') {
        const { campaigns } = parseBody<{ campaigns: CampaignRecord[] }>()
        const existing = JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) ?? '[]') as CampaignRecord[]
        const byId = new Map(existing.map((c) => [c.id, c]))
        for (const c of campaigns) byId.set(c.id, c)
        localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify([...byId.values()]))
        return res(200, { imported: campaigns.length })
      }

      if (path === '/api/campaigns') {
        if (method === 'GET') return res(200, CampaignModel.findAll())
        if (method === 'POST') return res(201, CampaignModel.create(parseBody<CreateCampaignInput>()))
      }

      const idMatch = path.match(/^\/api\/campaigns\/(.+)$/)
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1])
        if (method === 'GET') {
          const found = CampaignModel.findById(id)
          return found ? res(200, found) : res(404, { error: 'Campaign not found' })
        }
        if (method === 'PATCH') {
          const updated = CampaignModel.update(id, parseBody<UpdateCampaignInput>())
          return updated ? res(200, updated) : res(404, { error: 'Campaign not found' })
        }
        if (method === 'DELETE') {
          return CampaignModel.delete(id) ? res(204) : res(404, { error: 'Campaign not found' })
        }
      }

      return res(404, { error: 'Not found' })
    }),
  )
}

/** Remove the fetch mock. Call in a test's afterEach. */
export function uninstallMockCampaignsApi(): void {
  vi.unstubAllGlobals()
}
