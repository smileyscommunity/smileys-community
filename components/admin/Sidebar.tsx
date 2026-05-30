'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'

// SVG icon components
function Icon({ d, d2 }: { d: string; d2?: string }) {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d} />
      {d2 && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d2} />}
    </svg>
  )
}

const ICONS: Record<string, JSX.Element> = {
  dashboard:    <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  modHome:      <Icon d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
  partners:     <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
  analytics:    <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  applications: <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  users:        <Icon d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />,
  moderation:   <Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />,
  audit:        <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />,
  retention:    <Icon d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  events:       <Icon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  participants: <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
  checkin:      <Icon d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />,
  clubs:        <Icon d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  hosts:        <Icon d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />,
  tags:         <Icon d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />,
  payments:     <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />,
  notifications:<Icon d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />,
  engagement:   <Icon d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />,
  settings:     <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
  security:     <Icon d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
  spotlight:    <Icon d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />,
  banners:      <Icon d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />,
  stories:      <Icon d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  articles:     <Icon d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />,
  content:      <Icon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />,
  board:        <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
  // Speech-bubble / message icon — reads as "feedback / response."
  feedback:     <Icon d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
}

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard',    href: '/admin',            exact: true,  roles: ['admin'],      icon: 'dashboard' },
      { label: 'Mod Home',     href: '/admin/moderator',  exact: true,  roles: ['moderator'],  icon: 'modHome'   },
      { label: 'Analytics',    href: '/admin/analytics',  exact: false, roles: ['admin'],      icon: 'analytics' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Applications', href: '/admin/applications', exact: false, roles: ['admin', 'moderator'],  icon: 'applications' },
      { label: 'Users',        href: '/admin/users',        exact: false, roles: ['admin'],               icon: 'users'        },
      // "Reports" used to point at a misnamed analytics page; the actual
      // member-reports queue lives at /admin/moderation (default tab).
      { label: 'Moderation',   href: '/admin/moderation',   exact: false, roles: ['admin', 'moderator'],  icon: 'moderation'   },
      // Moderators get a Retention shortcut here since they can't see Analytics
      // (admin-only API). Admins access the same data via Analytics > Members
      // tab, where it's folded in alongside the engagement summary.
      { label: 'Retention',    href: '/admin/retention',    exact: false, roles: ['moderator'],  icon: 'retention'    },
      { label: 'Audit Log',    href: '/admin/audit',        exact: false, roles: ['admin', 'moderator'],  icon: 'audit'        },
    ],
  },
  {
    label: 'Events',
    items: [
      { label: 'Events',       href: '/admin/events',       exact: false, roles: ['admin', 'host'],            icon: 'events'       },
      { label: 'Participants', href: '/admin/participants',  exact: false, roles: ['admin', 'host'],            icon: 'participants' },
      { label: 'Check-In',     href: '/admin/checkin',       exact: false, roles: ['admin', 'host'],            icon: 'checkin'      },
      // Feedback ✿ = post-event safety + quality surveys. Lives here
      // because it's per-event signal, not a moderation action. The
      // auto-filed anomaly Reports still surface under Moderation
      // (where they get triaged).
      { label: 'Feedback',     href: '/admin/feedback',      exact: false, roles: ['admin', 'moderator'],       icon: 'feedback'     },
    ],
  },
  {
    label: 'Community',
    items: [
      { label: 'Clubs',        href: '/admin/clubs',        exact: false, roles: ['admin'],               icon: 'clubs'        },
      { label: 'Hosts',        href: '/admin/hosts',        exact: false, roles: ['admin'],               icon: 'hosts'        },
      { label: 'Board',        href: '/admin/listings',     exact: false, roles: ['admin', 'moderator'],  icon: 'board'        },
      { label: 'Spotlight',    href: '/admin/spotlight',    exact: false, roles: ['admin', 'moderator'],  icon: 'spotlight'    },
      { label: 'Partners',     href: '/admin/partners',     exact: false, roles: ['admin', 'moderator'],  icon: 'partners'     },
      { label: 'Tags',         href: '/admin/tags',         exact: false, roles: ['admin'],               icon: 'tags'         },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Payments', href: '/admin/payments', exact: false, roles: ['admin'], icon: 'payments' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Notifications', href: '/admin/notifications',                 exact: false, roles: ['admin', 'moderator'],  icon: 'notifications' },
      // Was /admin/engagement (misnamed as analytics); now /admin/announcements
      // and lives in this Content group alongside the other comms surfaces.
      { label: 'Announcements', href: '/admin/announcements?tab=announcement', exact: false, roles: ['admin', 'moderator'],  icon: 'banners'    },
      { label: 'Polls',         href: '/admin/announcements?tab=polls',        exact: false, roles: ['admin', 'moderator'],  icon: 'engagement' },
      { label: 'Stories',       href: '/admin/stories',                     exact: false, roles: ['admin', 'moderator'],  icon: 'stories'       },
      { label: 'Articles',      href: '/admin/posts',         exact: false, roles: ['admin', 'moderator'],  icon: 'articles'      },
      { label: 'Neighborhoods', href: '/admin/neighborhoods', exact: false, roles: ['admin', 'moderator'],  icon: 'tags'          },
      { label: 'City Guide',    href: '/admin/guide',         exact: false, roles: ['admin', 'moderator'],  icon: 'content'       },
      { label: 'Banners',       href: '/admin/banners',       exact: false, roles: ['admin', 'moderator'],  icon: 'banners'       },
      { label: 'Content',       href: '/admin/content',       exact: false, roles: ['admin', 'moderator'],  icon: 'content'       },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Settings',  href: '/admin/settings',  exact: false, roles: ['admin'],  icon: 'settings' },
      { label: 'Security',  href: '/admin/security',  exact: false, roles: ['admin'],  icon: 'security'  },
    ],
  },
]

export const navItems = NAV_GROUPS.flatMap(g => g.items)

export const ICON_PATHS: Record<string, { d: string; d2?: string }> = {
  dashboard:    { d: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  modHome:      { d: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  partners:     { d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  analytics:    { d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  applications: { d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  users:        { d: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  moderation:   { d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  audit:        { d: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  retention:    { d: 'M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  events:       { d: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  participants: { d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  checkin:      { d: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
  clubs:        { d: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  hosts:        { d: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  tags:         { d: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z' },
  payments:     { d: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  notifications:{ d: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  engagement:   { d: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
  settings:     { d: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z', d2: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  security:     { d: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  spotlight:    { d: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
  banners:      { d: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
  stories:      { d: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  articles:     { d: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z' },
  content:      { d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
  board:        { d: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function Sidebar({ open, onClose }: Props) {
  const pathname   = usePathname()
  const { user, logout } = useAuth()
  const role       = user.role
  const isHost     = user.isClubHost === true
  const userRoles  = [role, ...(isHost ? ['host'] : [])]

  // Pending-count badges on Applications / Moderation. mod-stats is already
  // polled by Topbar, so this adds one more poll per admin page — cheap, and
  // it turns the sidebar into a "where is the work" cue.
  const [counts, setCounts] = useState<{ applications: number; reports: number }>({ applications: 0, reports: 0 })
  useEffect(() => {
    function load() {
      fetch('/app/api/admin/mod-stats', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d) setCounts({
            applications: d.pendingApplications ?? 0,
            reports:      d.pendingReports      ?? 0,
          })
        })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  // Per-item badge count. Add more mappings here as additional pending
  // signals come online (e.g. unreviewed audit lines).
  function badgeFor(href: string): number {
    if (href.startsWith('/admin/applications')) return counts.applications
    if (href.startsWith('/admin/moderation'))   return counts.reports
    return 0
  }

  const canSee  = (item: typeof navItems[0]) => item.roles.some(r => userRoles.includes(r))
  const isActive = (item: typeof navItems[0]) => {
    const [hrefPath, hrefQuery] = item.href.split('?')
    if (item.exact) return pathname === hrefPath
    if (!pathname.startsWith(hrefPath)) return false
    if (hrefQuery) {
      const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
      const [key, val] = hrefQuery.split('=')
      return params.get(key) === val
    }
    // For tab-routed pages without a query specifier, don't false-match
    // tab-specific links (otherwise both Announcements + Polls would
    // highlight at /admin/announcements with no ?tab=).
    if (hrefPath === '/admin/announcements') return false
    if (hrefPath === '/admin/engagement')    return false  // legacy redirect
    return true
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/70 z-40 md:hidden backdrop-blur-sm" onClick={onClose} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 bg-zinc-950 border-r border-white/5 flex flex-col
        w-full md:w-60
        transform transition-transform duration-200 ease-in-out
        md:static md:translate-x-0 md:shrink-0
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>

        {/* Logo */}
        <div className="flex items-center gap-3 px-5 h-14 border-b border-white/5 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center text-sm shrink-0">😊</div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white tracking-tight leading-none">Smileys</div>
            <div className="text-xs text-zinc-500 mt-0.5 uppercase tracking-widest">Admin</div>
          </div>
          <button onClick={onClose} className="md:hidden ml-auto p-2 text-zinc-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5 md:space-y-6">
          {NAV_GROUPS.map(group => {
            const visible = group.items.filter(canSee)
            if (!visible.length) return null
            return (
              <div key={group.label}>
                <p className="text-xs font-semibold text-zinc-600 uppercase tracking-widest px-2 mb-2 md:mb-1.5">
                  {group.label}
                </p>

                {/* Mobile: 2-column card grid; Desktop: single-column list */}
                <div className="grid grid-cols-2 gap-1.5 md:grid-cols-1 md:gap-0 md:space-y-0.5">
                  {visible.map(item => {
                    const active = isActive(item)
                    const badge  = badgeFor(item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={`relative flex transition-all
                          flex-col items-center justify-center gap-1.5 px-2 py-4 rounded-xl text-xs font-medium text-center
                          md:flex-row md:items-center md:justify-start md:gap-3 md:px-3 md:py-2.5 md:rounded-lg md:text-sm
                          ${active
                            ? 'bg-white/10 text-white md:bg-white/8 md:font-medium'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 md:text-zinc-500'
                          }`}
                      >
                        {/* Desktop-only active indicator */}
                        {active && (
                          <span className="hidden md:block absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-amber-500 rounded-full" />
                        )}

                        {/* Icon — larger on mobile */}
                        <span className={`
                          relative flex items-center justify-center
                          w-10 h-10 rounded-xl md:w-auto md:h-auto md:rounded-none md:bg-transparent
                          [&>svg]:w-5 [&>svg]:h-5 md:[&>svg]:w-4 md:[&>svg]:h-4
                          ${active
                            ? 'bg-amber-500/20 text-amber-400 md:bg-transparent'
                            : 'bg-white/5 text-zinc-500 md:bg-transparent md:text-zinc-600'
                          }`}>
                          {ICONS[item.icon] ?? null}
                          {/* Mobile: dot indicator (no count to keep card compact) */}
                          {badge > 0 && (
                            <span className="md:hidden absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full ring-2 ring-zinc-950" />
                          )}
                        </span>

                        <span className="leading-tight flex-1 md:text-left">{item.label}</span>

                        {/* Desktop: count chip — shows the number so admins
                            spot work without clicking. */}
                        {badge > 0 && (
                          <span className="hidden md:inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-zinc-950 text-[10px] font-bold">
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-white/5 p-3 shrink-0">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors group">
            <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-white/10"
              style={{ backgroundColor: user.color }}>
              {user.profilePhoto
                ? <img src={resolveImageUrl(user.profilePhoto)} alt={user.name} className="w-full h-full object-cover" />
                : user.initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-zinc-200 truncate">{user.name}</div>
              <div className="text-xs text-zinc-500 capitalize">{user.role}</div>
            </div>
            <button
              onClick={logout}
              className="text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
              title="Sign out"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

      </aside>
    </>
  )
}
