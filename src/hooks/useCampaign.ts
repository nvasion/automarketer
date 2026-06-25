/**
 * useCampaign — React hook for reading a single campaign by id.
 *
 * Used by CampaignDetail to load and display a specific campaign.
 */

import { useState, useEffect } from 'react'
import { fetchCampaign, updateCampaign, ApiError } from '../api/campaigns'
import type { CampaignRecord, UpdateCampaignInput } from '../db/schema'

export interface UseCampaignResult {
  campaign: CampaignRecord | null
  loading: boolean
  error: string | null
  /**
   * Persist a partial update to the campaign and refresh the local state.
   * Returns the updated record, or throws on failure.
   */
  update: (patch: UpdateCampaignInput) => Promise<CampaignRecord>
}

export function useCampaign(id: string | undefined): UseCampaignResult {
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      setError('No campaign id provided')
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetchCampaign(id)
      .then((data) => {
        if (!cancelled) {
          setCampaign(data)
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
              : 'Failed to load campaign'
          setError(message)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [id])

  const update = async (patch: UpdateCampaignInput): Promise<CampaignRecord> => {
    if (!id) throw new Error('No campaign id')
    const updated = await updateCampaign(id, patch)
    setCampaign(updated)
    return updated
  }

  return { campaign, loading, error, update }
}
