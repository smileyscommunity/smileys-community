import { toast } from 'sonner'

/**
 * In-app replacement for window.confirm() — native dialogs are suppressed
 * in the installed PWA and some mobile browsers, which silently no-ops any
 * `if (!confirm(...)) return` guard. This renders a sonner toast with
 * Confirm / Cancel actions and resolves to a boolean, so it's a near
 * drop-in: `if (!(await confirmToast('Delete this?'))) return`.
 *
 * Resolves false if the toast is dismissed (swiped/auto-closed) or Cancel
 * is tapped; true only on Confirm.
 */
export function confirmToast(
  message: string,
  opts: { confirmLabel?: string; cancelLabel?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: boolean) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const id = toast(message, {
      duration: Infinity,
      action: {
        label: opts.confirmLabel ?? 'Confirm',
        onClick: () => { done(true); toast.dismiss(id) },
      },
      cancel: {
        label: opts.cancelLabel ?? 'Cancel',
        onClick: () => { done(false); toast.dismiss(id) },
      },
      onDismiss: () => done(false),
      onAutoClose: () => done(false),
    })
  })
}
