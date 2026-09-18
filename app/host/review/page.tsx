import AttendanceReviewList from '@/components/AttendanceReviewList'

// A host's own rooms, in the window where they can still be fixed. Same data
// and same component as /admin/attendance-review; the API scopes the rows.
export default function HostAttendanceReviewPage() {
  return (
    <AttendanceReviewList
      heading="Attendance review"
      blurb="Who wasn’t checked in at your events, and how long you have to fix it."
    />
  )
}
