type Listener = () => void

let pending = 0
let label = 'Loading…'
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeLoading(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLoadingState() {
  return { busy: pending > 0, label }
}

export function startLoading(nextLabel: string) {
  pending += 1
  label = nextLabel
  emit()
}

export function stopLoading() {
  pending = Math.max(0, pending - 1)
  if (pending === 0) label = 'Loading…'
  emit()
}

export function loadingLabelFor(method: string, path: string) {
  if (path.includes('/login')) return 'Signing in…'
  if (path.includes('/logout')) return 'Signing out…'
  if (path.includes('/change-password')) return 'Updating password…'
  if (method === 'GET') return 'Loading…'
  if (method === 'DELETE') return 'Removing…'
  return 'Saving…'
}
