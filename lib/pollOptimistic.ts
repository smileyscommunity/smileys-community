// The poll widget shows the member's vote the moment they tap, before the
// server answers — the results bar is the reward for voting, and waiting on
// two round trips (vote, then refetch) for it felt broken on a slow phone.
// This is the local guess at what the server will say; the refetch that
// follows a successful vote replaces it with the real tallies.

export interface PollOption {
  id:      string
  text:    string
  votes:   number
  percent: number
}

export interface PollState {
  id:            string
  question:      string
  totalVotes:    number
  votedOptionId: string | null
  options:       PollOption[]
}

export function applyOptimisticVote(poll: PollState, optionId: string): PollState {
  if (poll.votedOptionId || !poll.options.some(o => o.id === optionId)) return poll
  const totalVotes = poll.totalVotes + 1
  return {
    ...poll,
    totalVotes,
    votedOptionId: optionId,
    options: poll.options.map(o => {
      const votes = o.id === optionId ? o.votes + 1 : o.votes
      // Same rounding as GET /api/community-poll, so the bars don't shift
      // when the real numbers land.
      return { ...o, votes, percent: Math.round((votes / totalVotes) * 100) }
    }),
  }
}
