/**
 * useCampaigns — React hook for reading the campaign list.
 *
 * Loads all campaigns from the API on mount and exposes loading / error state.
 * Components that need the full list (Dashboard, CampaignList, Scheduler,
 * Analytics) import this hook instead of reading `SAMPLE_CAMPAIGNS` directly.
 */

import { useState, useEffect, useCallback } from 'react'
import { fetchCampaigns, fetchCampaignStats, ApiError } from '../api/campaigns'
import type { CampaignRecord, CampaignStats } from '../db/schema'

// ─── useCampaigns ─────────────────────────────────────────────────────────────

export interface UseCampaignsResult {
  campaigns: CampaignRecord[]
  loading: boolean
  error: string | null
  /** Manually re-fetch campaigns (e.g. after a create/update/delete). */
  refresh: () => void
}

export function useCampaigns(): UseCampaignsResult {
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchCampaigns()
      .then((data) => {
        if (!cancelled) {
          setCampaigns(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
              ? err.message
              : 'Failed to load campaigns'
          setError(message)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  return { campaigns, loading, error, refresh }
}

// ─── useCampaignStats ─────────────────────────────────────────────────────────

export interface UseCampaignStatsResult {
  stats: CampaignStats | null
  loading: boolean
  error: string | null
}

export function useCampaignStats(): UseCampaignStatsResult {
  const [stats, setStats] = useState<CampaignStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchCampaignStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
              ? err.message
              : 'Failed to load stats'
          setError(message)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { stats, loading, error }
}
