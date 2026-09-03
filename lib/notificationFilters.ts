// Notification presentation: which tab a type belongs under, and what icon it
// carries. One module because there were two of each — the bell dropdown and
// the /notifications page kept their own copies, and they had already drifted:
// the bell knew `directory_submission` and `membership_upgraded`, the page knew
// every no-show and reconfirm type, so a yellow-card notification showed 🟨 on
// the page and a generic 🔔 in the bell.
//
// Client-safe (no imports): both consumers are client components.

export type Filter = 'All' | 'Events' | 'Social' | 'Admin'

export const FILTERS: Filter[] = ['All', 'Events', 'Social', 'Admin']

// Buckets built from the notification types that actually exist in prod.
// Previously Social held only RSVP types (which are event-lifecycle) and
// the genuinely social ones — connections, messages, club activity,
// hangouts — mapped to NO tab, so "Social" showed the wrong list and most
// notifications were findable only under All.
//
// An unmapped type is not a cosmetic bug: `filtered` keeps only types present
// in the selected bucket, so a type in no bucket is invisible under every tab
// except All. On 2026-09-03 that was 22,699 rows across 10 types — `new_article`
// alone (21,921) being the second most common type in the database. Anything
// added here must also be added to a bucket; tests/notificationFilterCoverage
// fails the build otherwise.
export const FILTER_TYPES: Record<Filter, string[]> = {
  All:    [],
  Events: [
    'new_event', 'event_updated', 'event_cancelled', 'reminder_24h', 'reminder_2h',
    'attendee_joined', 'review_request', 'event_survey', 'rsvp', 'rsvp_pending',
    'waitlist', 'waitlist_joined', 'waitlist_promoted', 'spot_opened',
    'checkin', 'checkin_started', 'checkin_count', 'event_message', 'event_photos',
    'host_message', 'payment_reminder', 'payment_attention',
    // Day-before reconfirmation and no-show cards are event lifecycle too.
    'reconfirm_ask', 'reconfirm_released',
    'no_show_yellow', 'no_show_red', 'no_show_restriction_active', 'no_show_waived',
    'no_show_downgraded', 'no_show_waitlist_removed', 'no_show_cards_issued', 'no_show_appeal_resolved',
  ],
  Social: [
    'connection_request', 'connection_accepted', 'connection_suggestion',
    'message', 'profile_view', 'good_reference',
    'club_wall_post', 'club_post_reply', 'club_mention', 'neighborhood_mention',
    'new_hangout', 'hangout_starting', 'hangout_recap', 'hangout_join',
    'hangout_cancelled', 'hangout_message', 'hangout_updated',
    'availability_pulse', 'pulse_wave',
    // Community board: a new listing and the replies/interest it draws are
    // member-to-member, the same as a club wall post.
    'listing_new', 'board_interest', 'board_reply',
    // Someone announcing a visit is an invitation to meet, not admin business.
    'visitor_announced', 'visitor_tip',
  ],
  Admin:  [
    'club_approved', 'club_rejected', 'host_assigned', 'announcement',
    'warning', 'system_alert', 'alert', 'system', 'application',
    'report', 'report_alert', 'report_reviewed', 'membership_upgraded',
    'nps_survey', 'listing_expiry', 'no_show_appeal',
    // From the team, rather than from another member: new articles, one-off
    // broadcasts, and a city going live all read as notices, like 'announcement'.
    'new_article', 'broadcast', 'city_launch',
    'directory_submission', 'directory_review_nudge',
    // Things a member submits for review — they land in a moderator queue.
    'story_submission', 'testimonial_submission',
  ],
}

export const TYPE_ICON: Record<string, string> = {
  reconfirm_ask:       '🙋',
  reconfirm_released:  '🚪',
  no_show_yellow:      '🟨',
  no_show_red:         '🟥',
  no_show_restriction_active: '⏸️',
  no_show_waived:      '✅',
  no_show_downgraded:  '🟨',
  no_show_waitlist_removed: '📋',
  no_show_cards_issued: '🧾',
  no_show_appeal:      '📨',
  no_show_appeal_resolved: '⚖️',
  checkin:             '✅',
  checkin_started:     '📲',
  checkin_count:       '🔢',
  rsvp:                '🎉',
  rsvp_pending:        '⏳',
  waitlist:            '📋',
  waitlist_joined:     '📋',
  waitlist_promoted:   '✅',
  spot_opened:         '🎟️',
  club_approved:       '🏛️',
  club_rejected:       '❌',
  new_event:           '📣',
  attendee_joined:     '🙌',
  review_request:      '⭐',
  event_updated:       '📅',
  event_cancelled:     '😔',
  event_message:       '📨',
  event_photos:        '📸',
  host_assigned:       '🎖️',
  host_message:        '📨',
  reminder_24h:        '⏰',
  reminder_2h:         '⚡',
  message:             '💬',
  visitor_tip:         '💡',
  visitor_announced:   '🧳',
  warning:             '⚠️',
  announcement:        '📢',
  broadcast:           '📢',
  new_article:         '📰',
  city_launch:         '🌍',
  system_alert:        '🚨',
  alert:               '🚨',
  reminder:            '⏰',
  club_wall_post:      '📝',
  club_post_reply:     '💬',
  club_mention:        '💬',
  neighborhood_mention:'💬',
  new_hangout:         '🥂',
  hangout_starting:    '⏱️',
  hangout_join:        '🙌',
  hangout_message:     '💬',
  hangout_recap:       '📖',
  hangout_cancelled:   '😔',
  hangout_updated:     '🔄',
  availability_pulse:  '📶',
  pulse_wave:          '📶',
  profile_view:        '👀',
  good_reference:      '🌟',
  connection_request:  '🤝',
  connection_accepted: '🤝',
  connection_suggestion: '✨',
  report:              '🚩',
  application:         '👤',
  event_survey:        '✍️',
  nps_survey:          '📊',
  payment_reminder:    '💳',
  payment_attention:   '💳',
  listing_expiry:      '⌛',
  membership_upgraded: '⭐',
  // Admin/moderator-only — distinct icon so directory submissions
  // stand out from generic 'system' bell entries.
  directory_submission: '📋',
  directory_review_nudge: '📝',
  listing_new:         '🏷️',
  board_interest:      '🙋',
  board_reply:         '💬',
  story_submission:    '📝',
  testimonial_submission: '🗣️',
  report_alert:        '🚩',
  report_reviewed:     '⚖️',
  system:              '⚙️',
}
