// Neighborhood picks surfaced in the /onboarding step-4 grid. This
// is intentionally a curated subset (24-ish) rather than the full
// NEIGHBORHOOD_META in lib/neighborhoods.ts — onboarding is meant
// to be quick, so we show the social-hub neighborhoods most new
// members care about. Keep the inline ids stable (e.g. 'kadikoy')
// — recommendation logic in /onboarding step 5 keys off them.
export interface OnboardingNeighborhood {
  id:    string
  label: string
  emoji: string
  desc:  string
}

export const ONBOARDING_NEIGHBORHOODS: OnboardingNeighborhood[] = [
  // Central social hubs
  { id: 'kadikoy',        label: 'Kadıköy',        emoji: '🎨', desc: 'Artsy & vibrant'           },
  { id: 'moda',           label: 'Moda',            emoji: '☕', desc: 'Laid-back & local'          },
  { id: 'besiktas',       label: 'Beşiktaş',        emoji: '⚡', desc: 'Lively & social'            },
  { id: 'beyoglu',        label: 'Beyoğlu',         emoji: '🌃', desc: 'Culture & nightlife'        },
  { id: 'karakoy',        label: 'Karaköy',         emoji: '🖼️', desc: 'Galleries & coffee'         },
  { id: 'galata',         label: 'Galata',          emoji: '🏰', desc: 'Historic & charming'        },
  { id: 'cihangir',       label: 'Cihangir',        emoji: '🎭', desc: 'Bohemian & creative'        },
  { id: 'nisantasi',      label: 'Nişantaşı',       emoji: '👜', desc: 'Upscale & fashionable'      },
  { id: 'tesviikiye',     label: 'Teşvikiye',       emoji: '🌹', desc: 'Quiet luxury & boutiques'   },
  { id: 'taksim',         label: 'Taksim',          emoji: '🎶', desc: 'Central & buzzing'          },
  { id: 'ortakoy',        label: 'Ortaköy',         emoji: '🕌', desc: 'Iconic & scenic'            },
  { id: 'balat',          label: 'Balat',           emoji: '🌈', desc: 'Colourful & artsy'          },
  // European side
  { id: 'sisli',          label: 'Şişli',           emoji: '🏙️', desc: 'Business & fashion'         },
  { id: 'levent',         label: 'Levent',          emoji: '🏢', desc: 'Corporate & modern'         },
  { id: 'etiler',         label: 'Etiler',          emoji: '🌿', desc: 'Leafy & affluent'           },
  { id: 'bomonti',        label: 'Bomonti',         emoji: '🍺', desc: 'Up-and-coming'              },
  { id: 'bebek',          label: 'Bebek',           emoji: '🛥️', desc: 'Bosphorus & affluent'       },
  { id: 'fulya',          label: 'Fulya',           emoji: '🌿', desc: 'Trendy & residential'       },
  // Asian side
  { id: 'uskudar',        label: 'Üsküdar',         emoji: '🌅', desc: 'Traditional & scenic'       },
  { id: 'kuzguncuk',      label: 'Kuzguncuk',       emoji: '🌸', desc: 'Village charm & cafés'      },
  { id: 'caddebostan',    label: 'Caddebostan',     emoji: '🏖️', desc: 'Beachside & social'         },
  { id: 'fenerbahce',     label: 'Fenerbahçe',      emoji: '⚽', desc: 'Sporty & scenic'            },
  // Coastal
  { id: 'emirgan',        label: 'Emirgan',         emoji: '🌷', desc: 'Tulip gardens & Bosphorus'  },
  { id: 'zekeriyakoy',   label: 'Zekeriyaköy',    emoji: '🌲', desc: 'Forest retreat'             },
  { id: 'arnavutkoy',     label: 'Arnavutköy',      emoji: '🏡', desc: 'Village charm on the Bosphorus' },
]
