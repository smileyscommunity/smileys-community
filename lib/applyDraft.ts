// The application form's saved draft (app/apply/ApplyClient). Two parts:
// the answers in localStorage for a week, and the contact details — email,
// phone, date of birth — only in sessionStorage, gone when the tab closes.
// It kept all of it in localStorage for ever, so on a shared phone or an
// internet café the next person to open /apply found the last applicant's
// name, email, phone and date of birth filled in.
export const DRAFT_KEY = 'smileys_apply_draft_v1'
export const DRAFT_CONTACT_KEY = 'smileys_apply_contact_v1'
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function clearApplyDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
  try { sessionStorage.removeItem(DRAFT_CONTACT_KEY) } catch {}
}
