-- Attribution for a "would not return" survey answer. When wouldReturn is
-- false, why: 'host' | 'guest' | 'venue' | 'timing' | 'other'. Nullable so
-- every existing row (and every "would return: yes") stays valid. An
-- anonymous diagnostic surfaced to moderators on /admin/feedback — NOT fed
-- into the host's wouldReturnRate (which stays a raw share of all responses).
ALTER TABLE "event_surveys" ADD COLUMN "returnDeclineReason" TEXT;
