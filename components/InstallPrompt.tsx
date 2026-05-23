'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop' | 'other'>('other')
  const [isInApp, setInApp] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)

  useEffect(() => {
    // Platform detection
    const ua = window.navigator.userAgent.toLowerCase()
    const isIos = /iphone|ipad|ipod/.test(ua)
    const isAndroid = /android/.test(ua)
    const isChrome = /chrome|crios/.test(ua)
    
    const isInAppBrowser = isIos && (/fban|fbav|instagram|threads|line|whatsapp|skype|viber|messenger|twitter|telegram/.test(ua))

    if (isIos) setPlatform('ios')
    else if (isAndroid) setPlatform('android')
    else if (isChrome) setPlatform('desktop')
    
    setInApp(isInAppBrowser)

    // Check if already in standalone mode (installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator as any).standalone || 
                        document.referrer.includes('android-app://')

    // Install prompt listener (Android/Chrome)
    const handler = (e: any) => {
      e.preventDefault()
      setDeferredPrompt(e)
      
      // Auto-show logic
      if (!isStandalone && !localStorage.getItem('pwa_prompt_seen')) {
        setTimeout(() => setShow(true), 3000)
      }
    }

    window.addEventListener('beforeinstallprompt', handler)

    const manualHandler = () => {
      setShow(true)
    }
    window.addEventListener('show-install-prompt', manualHandler)

    // Auto-show for iOS (manual detection)
    if (isIos && !isStandalone && !localStorage.getItem('pwa_prompt_seen')) {
      setTimeout(() => setShow(true), 4000)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('show-install-prompt', manualHandler)
    }
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setShow(false)
    }
    setDeferredPrompt(null)
  }

  function dismiss() {
    setShow(false)
    localStorage.setItem('pwa_prompt_seen', 'true')
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          className="fixed bottom-24 md:bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-80 z-[70]"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-5 text-white">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center text-2xl shrink-0 shadow-lg shadow-amber-500/20">
                😊
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm">Install Smileys App</h3>
                  <button onClick={dismiss} className="text-zinc-600 hover:text-zinc-400 -mt-1 -mr-1 p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {isInApp
                    ? 'You are viewing this inside an app. To install, please open it in Safari first.'
                    : platform === 'ios' 
                    ? 'Tap the Share button and select "Add to Home Screen" for the best experience.'
                    : platform === 'android' || platform === 'desktop'
                    ? 'Get faster access and notifications by installing our app.'
                    : 'To install, open your browser menu and select "Add to Home Screen".'}
                </p>
                
                <div className="mt-4 space-y-3">
                  {isInApp ? (
                    <div className="p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
                       <p className="text-xs text-zinc-300 font-medium leading-relaxed">
                          Tap the <strong className="text-white">three dots (...)</strong> or <strong className="text-white">compass icon</strong> and select <strong className="text-white">&quot;Open in Safari&quot;</strong>.
                        </p>
                    </div>
                  ) : deferredPrompt ? (
                    <button
                      onClick={handleInstall}
                      className="w-full py-2.5 bg-amber-500 text-black text-xs font-bold rounded-xl hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/10"
                    >
                      Install now
                    </button>
                  ) : platform === 'ios' ? (
                    <div className="space-y-3">
                      <div className="p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
                        <p className="text-xs text-zinc-300 font-medium leading-relaxed">
                          1. <strong className="text-white">Scroll up</strong> to show the bottom bar.
                        </p>
                        <p className="text-xs text-zinc-300 font-medium leading-relaxed mt-2">
                          2. Tap the <strong className="text-white">Share</strong> button 
                          <span className="inline-flex mx-1 align-middle text-amber-500">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                          </span>
                          (at the bottom).
                        </p>
                        <p className="text-xs text-zinc-300 font-medium leading-relaxed mt-2">
                          3. Select <strong className="text-white">&quot;Add to Home Screen&quot;</strong>.
                        </p>
                      </div>
                      <button
                        onClick={dismiss}
                        className="w-full py-2 bg-zinc-800 text-zinc-300 text-xs font-bold rounded-xl hover:bg-zinc-700 transition-colors"
                      >
                        Got it
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={dismiss}
                      className="w-full py-2 bg-zinc-800 text-zinc-300 text-xs font-bold rounded-xl hover:bg-zinc-700 transition-colors"
                    >
                      Got it
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
