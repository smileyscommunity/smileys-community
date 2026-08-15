'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

interface FooterProps {
  stats?: { value: string; label: string }[]
}

// Only reached if the layout passes nothing (it passes measured numbers when
// there's no admin override — see lib/communityStats). Kept minimal rather
// than a second set of figures to drift out of date.
const DEFAULT_STATS: { value: string; label: string }[] = []

export default function Footer({ stats }: FooterProps) {
  const { isLoggedIn } = useAuth()
  const footerStats = stats?.slice(0, 3) ?? DEFAULT_STATS

  return (
    <footer className="bg-white border-t border-gray-100">

      {/* CTA band — the "Find your people in Istanbul" / Apply-to-join
          pitch is aimed at prospects. For signed-in members it just adds
          ~200px of empty space between the real page content and the
          rest of the footer (worst on short-content mobile screens like
          the members page after "Load more"). Hide it once someone's in
          the app; they have the bottom nav for navigation. */}
      {!isLoggedIn && (
        <div className="bg-amber-500">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div>
              <p className="text-amber-950/60 text-sm font-medium mb-1">Istanbul's curated social community</p>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                Find your people in Istanbul.
              </h2>
            </div>
            <div className="flex flex-col items-center sm:items-end gap-2 shrink-0">
              <div className="flex items-center gap-3">
                <Link href="/apply"
                  className="px-6 py-3 rounded-2xl bg-white text-amber-600 font-bold text-sm hover:bg-amber-50 transition-colors shadow-sm">
                  Apply to join
                </Link>
                <Link href="/about"
                  className="px-6 py-3 rounded-2xl border border-amber-400/50 text-white font-semibold text-sm hover:bg-amber-600 transition-colors">
                  Learn more
                </Link>
              </div>
              <p className="text-xs text-amber-950/60">
                Free to join · Reviewed by hand within 24 hours · Pay only for events you attend
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats strip */}
      <div className="bg-gray-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-sm text-gray-600">
            {footerStats.map((s, i) => (
              <Fragment key={s.label}>
                <span className="flex items-center gap-2">
                  <span className="text-amber-500 font-bold text-base">{s.value}</span> {s.label}
                </span>
                {i < footerStats.length - 1 && (
                  <span className="text-gray-200 hidden sm:block">|</span>
                )}
              </Fragment>
            ))}
            <span className="text-gray-200 hidden sm:block">|</span>
            <span className="flex items-center gap-2">
              🇹🇷 <span>Founded in Istanbul</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main footer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        {/* 4 cols at lg (small laptops) so the 6-col layout doesn't crush each
            column to ~140px; 6 cols at xl+ where there's room to fit everything
            on one row. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-10">

          {/* Brand — wider until xl so the social row breathes */}
          <div className="col-span-2 xl:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4 group">
              <span className="text-2xl">😊</span>
              <span className="font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors text-lg">
                Smileys Community
              </span>
            </Link>
            <p className="text-sm text-gray-600 leading-relaxed max-w-xs mb-5">
              Real people, genuine friendships, unforgettable experiences.
            </p>

            {/* Social links */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* sr-only labels (not just aria-label) so text-mode renderers —
                  reader modes, crawlers, AI page audits — show the network
                  name instead of falling back to the raw href. */}
              <a href="https://www.instagram.com/smileys.community" target="_blank" rel="noopener noreferrer" aria-label="Instagram" title="Follow us on Instagram"
                className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-pink-50 flex items-center justify-center transition-colors duration-200 group">
                <span className="sr-only">Instagram</span>
                <svg className="w-4 h-4 text-gray-600 group-hover:text-pink-500 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
              </a>
              <a href="https://linkedin.com/company/smileys-community" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" title="Find us on LinkedIn"
                className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-blue-50 flex items-center justify-center transition-colors duration-200 group">
                <span className="sr-only">LinkedIn</span>
                <svg className="w-4 h-4 text-gray-600 group-hover:text-blue-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
              <a href="https://www.facebook.com/aswistanbul/" target="_blank" rel="noopener noreferrer" aria-label="Facebook" title="Follow us on Facebook"
                className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-blue-50 flex items-center justify-center transition-colors duration-200 group">
                <span className="sr-only">Facebook</span>
                <svg className="w-4 h-4 text-gray-600 group-hover:text-blue-600 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
              </a>
              <a href="https://www.whatsapp.com/channel/0029VaCKyc29hXF4fZuOod1K" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp channel" title="Join our WhatsApp channel"
                className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-green-50 flex items-center justify-center transition-colors duration-200 group">
                <span className="sr-only">WhatsApp channel</span>
                <svg className="w-4 h-4 text-gray-600 group-hover:text-green-500 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </a>
            </div>
          </div>

          {/* Connect — action-y: events, people, real-time */}
          <div>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">Connect</h3>
            <ul className="space-y-3">
              {[
                { href: '/events',   label: 'Events 🎉'      },
                { href: '/clubs',    label: 'Clubs 🏠'       },
                { href: '/members',  label: 'Members 👥'     },
                { href: '/hangouts', label: 'Hangouts ☕'    },
                { href: '/visiting', label: 'Visiting? 👋'   },
                { href: '/cup',      label: 'Smileys Cup ⚽' },
              ].map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources — content / browse */}
          <div>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">Resources</h3>
            <ul className="space-y-3">
              {[
                { href: '/guide',         label: 'Istanbul Guide 🗺️'     },
                { href: '/handbook',      label: 'The Handbook 📖'       },
                { href: '/neighborhoods', label: 'Neighborhoods 🏘️'      },
                { href: '/board',       label: 'Community Board 💬'    },
                { href: '/marketplace', label: 'Marketplace 🛍️'       },
                { href: '/directory',     label: 'Business Directory 🏢'  },
                { href: '/posts',         label: 'Articles 📰'           },
              ].map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Membership — account + contributor links. Order respects funnel:
              anonymous visitors see Apply first (no Invite — they have nothing
              to invite people to yet); members see dashboard → invite (post-
              join action) → get-involved → advertise. */}
          <div>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">Membership</h3>
            <ul className="space-y-3">
              {[
                ...(isLoggedIn
                  ? [
                      { href: '/dashboard',    label: 'My dashboard 🏡'    },
                      { href: '/invite',       label: 'Invite a friend 💌' },
                      { href: '/perks',        label: 'Member Perks 🎁'    },
                      { href: '/get-involved', label: 'Get involved 🙌'    },
                    ]
                  : [
                      { href: '/apply',        label: 'Apply to join ✨'   },
                      { href: '/get-involved', label: 'Get involved 🙌'    },
                    ]
                ),
                { href: '/advertise',    label: 'Advertise with us 📢' },
              ].map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">Company</h3>
            <ul className="space-y-3">
              {[
                { href: '/about',   label: 'About us 📖'    },
                { href: '/why',     label: 'Why Smileys? 💛' },
                { href: '/faq',     label: 'FAQ ❓'          },
                { href: '/contact', label: 'Contact 💬'      },
              ].map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">Legal</h3>
            <ul className="space-y-3">
              {[
                { href: '/terms',       label: 'Terms of use 📜'         },
                { href: '/privacy',     label: 'Privacy policy 🔒'       },
                { href: '/cookies',     label: 'Cookie policy 🍪'        },
                { href: '/guidelines',  label: 'Community guidelines 🤝' },
              ].map(l => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-gray-600 hover:text-amber-600 transition-colors whitespace-nowrap">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-xs text-gray-600">
            &copy; {new Date().getFullYear()} Smileys Community. All rights reserved.
          </p>
          <p className="text-xs text-gray-600">
            Made with ❤️ in Istanbul 🇹🇷
          </p>
        </div>
      </div>

    </footer>
  )
}
