import { toCsv } from '@/lib/admin/participantsView'

// Admin CSV exports built outside the pages so the escaping is testable.
// Names, emails, event titles, payment notes and waitlist industry/role are
// member- or admin-typed, and the file opens in Excel/Sheets, where a cell
// starting with = + - @ runs as a formula. Every cell, header included, goes
// through csvCell (via toCsv) — the same rule as the participants export.

export interface PaymentCsvRow {
  createdAt: string
  amount:    number
  currency:  string
  status:    string
  method:    string
  notes:     string | null
  user:      { name: string; email: string }
  event:     { title: string }
}

export function paymentsCsv(payments: PaymentCsvRow[]): string {
  const header = ['Date', 'Member name', 'Email', 'Event', 'Amount', 'Currency', 'Status', 'Method', 'Notes']
  const rows = payments.map(p => [
    new Date(p.createdAt).toISOString(),
    p.user.name,
    p.user.email,
    p.event.title,
    String(p.amount),
    p.currency,
    p.status,
    p.method,
    (p.notes ?? '').replace(/\r?\n/g, ' '),
  ])
  // UTF-8 BOM so Excel doesn't mangle the ₺ symbol on open.
  return '﻿' + toCsv([header, ...rows])
}

export interface MemberCsvRow {
  name:           string
  email:          string
  role:           string
  status:         string
  warningCount:   number
  nationality:    string | null
  joinedAt:       string
  lastActive:     string | null
  suspendedUntil: string | null
}

// isSuspended comes from the page so "suspended" keeps one definition.
export function membersCsv<U extends MemberCsvRow>(users: U[], isSuspended: (u: U) => boolean): string {
  const headers = ['Name', 'Email', 'Role', 'Status', 'Warnings', 'Nationality', 'Joined', 'Last Active']
  const rows = users.map(u => [
    u.name, u.email, u.role,
    isSuspended(u) ? 'suspended' : u.status,
    String(u.warningCount), u.nationality ?? '',
    new Date(u.joinedAt).toLocaleDateString('en-GB'),
    u.lastActive ? new Date(u.lastActive).toLocaleDateString('en-GB') : '',
  ])
  return toCsv([headers, ...rows])
}

export interface ProWaitlistCsvRow {
  position:  number
  isFounder: boolean
  name:      string
  email:     string
  industry:  string | null
  role:      string | null
  status:    string
  createdAt: string
}

export function proWaitlistCsv(entries: ProWaitlistCsvRow[]): string {
  const header = ['position', 'founder', 'name', 'email', 'industry', 'role', 'status', 'createdAt']
  const rows = entries.map(e => [
    e.position, e.isFounder ? 'yes' : 'no',
    e.name, e.email,
    e.industry ?? '', e.role ?? '',
    e.status, e.createdAt,
  ])
  return toCsv([header, ...rows])
}
