// The retention the privacy policy promises for applications (see
// app/api/cron/sweep-application-retention):
//   - rejected applications go 12 months after the decision (auto-rejections,
//     never reviewed, age from creation);
//   - the network and device data kept for fraud checks — IP address, user
//     agent, fingerprint — is cleared 90 days after the application.
const DAY = 24 * 60 * 60 * 1000
export const REJECTED_RETENTION_DAYS = 365
export const DEVICE_DATA_RETENTION_DAYS = 90

export function retentionWhere(now: Date = new Date()) {
  const rejectedBefore = new Date(now.getTime() - REJECTED_RETENTION_DAYS * DAY)
  const deviceBefore   = new Date(now.getTime() - DEVICE_DATA_RETENTION_DAYS * DAY)
  return {
    rejected: {
      status: 'rejected',
      OR: [
        { reviewedAt: { lt: rejectedBefore } },
        { reviewedAt: null, createdAt: { lt: rejectedBefore } },
      ],
    },
    deviceData: {
      createdAt: { lt: deviceBefore },
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }, { fingerprint: { not: null } }],
    },
  }
}
