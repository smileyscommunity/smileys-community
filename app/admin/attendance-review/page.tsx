import AttendanceReviewList from '@/components/AttendanceReviewList'

// Admin side of the review queue: every room the standing sweep is holding,
// across cities. The host-facing twin is /host/review.
export default function AdminAttendanceReviewPage() {
  return (
    <AttendanceReviewList
      heading="Attendance review"
      blurb="Rooms the standing sweep is holding, soonest deadline first."
    />
  )
}
