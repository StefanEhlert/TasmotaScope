import { useState, useEffect, useCallback } from 'react'
import { checkBackendAvailable, clearBackendHealthCache } from '../lib/backendClient'

export function useBackendAvailable(baseUrl?: string): {
  available: boolean
  loading: boolean
  refresh: () => Promise<void>
} {
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    clearBackendHealthCache()
    setLoading(true)
    try {
      const ok = await checkBackendAvailable(baseUrl)
      setAvailable(ok)
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { available, loading, refresh }
}
