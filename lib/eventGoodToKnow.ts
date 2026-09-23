import type { Event } from './data'

// The rows of the event page's "Good to know" block (components/
// EventGoodToKnow), kept pure so the no-invented-defaults rule is tested:
// every row is backed by a column on the event, and a row whose column is
// empty is not produced — no "Language: not specified", no assumed English.

export type GoodToKnowFacts = Pick<Event, 'isFirstTimerFriendly' | 'language' | 'approvalRequired' | 'refundPolicy' | 'limitedSpots' | 'totalSpots' | 'status'>

export function goodToKnowRows(event: GoodToKnowFacts): { key: string; icon: string; label: string; text: string }[] {
  const rows: { key: string; icon: string; label: string; text: string }[] = []
  if (event.isFirstTimerFriendly) {
    rows.push({ key: 'first-timer', icon: '👋', label: 'First-timer friendly', text: 'Picked by the team as an easy first Smileys event to come to on your own.' })
  }
  const language = event.language?.trim()
  if (language) {
    rows.push({ key: 'language', icon: '🗣️', label: 'Language', text: language })
  }
  if (event.limitedSpots && event.totalSpots > 0) {
    rows.push({ key: 'size', icon: '👥', label: 'Group size', text: `Up to ${event.totalSpots} people` })
  }
  if (event.approvalRequired) {
    rows.push({ key: 'approval', icon: '✋', label: 'Host approval', text: 'The host reviews each request. Your spot is confirmed once it says Approved.' })
  }
  const refund = event.refundPolicy?.trim()
  if (refund) {
    rows.push({ key: 'refund', icon: '↩️', label: 'Refunds', text: refund })
  }
  return rows
}
