// Optional filters for GET /api/connections.
//
// The dashboard's pending-requests widget only needs the requests waiting on
// the viewer, but the endpoint returned every connection the member has, both
// directions, so a well-connected member downloaded their whole network to
// render a card that is usually empty. `?direction=received&status=pending`
// asks for just that slice. Both are optional; with neither, callers get the
// full { sent, received } response they always have.
//
// An unknown value is a 400 rather than "ignore it": a misspelt filter quietly
// falling back to the full list is the exact cost this exists to avoid.

export type ConnectionDirection = 'sent' | 'received'
// 'declined' is deliberately absent: declined rows are decline-memory and
// never leave the server (see the GET handler).
export type ConnectionStatusFilter = 'pending' | 'accepted'

export type ConnectionFilters =
  | { ok: true; direction: ConnectionDirection | null; status: ConnectionStatusFilter | null }
  | { ok: false; error: string }

const DIRECTIONS: readonly string[] = ['sent', 'received']
const STATUSES:   readonly string[] = ['pending', 'accepted']

export function parseConnectionFilters(params: URLSearchParams): ConnectionFilters {
  const direction = params.get('direction')
  const status    = params.get('status')
  if (direction !== null && !DIRECTIONS.includes(direction)) {
    return { ok: false, error: 'direction must be "sent" or "received"' }
  }
  if (status !== null && !STATUSES.includes(status)) {
    return { ok: false, error: 'status must be "pending" or "accepted"' }
  }
  return {
    ok: true,
    direction: direction as ConnectionDirection | null,
    status:    status as ConnectionStatusFilter | null,
  }
}
