import { useEffect, useState } from 'react'
import { getLoadingState, subscribeLoading } from '../services/loading'

export function AppLoader() {
  const [state, setState] = useState(getLoadingState)

  useEffect(() => subscribeLoading(() => setState(getLoadingState())), [])

  if (!state.busy) return null

  return (
    <div className="global-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="global-loader-card">
        <span className="spinner" />
        <p>{state.label}</p>
      </div>
    </div>
  )
}
