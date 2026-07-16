// The event emoji palette, shared by every event create/edit form
// (host new/edit + admin new/edit). Keep it here — it used to live as a
// literal duplicated across those four pages, which drifted badly: the
// host forms had 36 while the admin forms had grown to 121, and neither
// included 🎉 (the default emoji a new event starts with). One list now.
//
// Loosely grouped: default + social/active · nightlife/creative · travel &
// landmarks · games · wellness/nature · food · water/rides · sports ·
// party/music · animals/sweets · film/indoor. Order is cosmetic (grid
// fill only) — add new ones near their group.
export const EVENT_EMOJIS = [
  '🎉', '⛵', '🍽️', '💬', '🗣️', '🎵', '🌿', '🎭', '🏃', '🎨', '🍷', '🧘',
  '🥾', '🎤', '☕', '🍺', '🍸', '💃', '🎬', '📸', '🚴', '🏊', '🏋️', '📚',
  '✍️', '🎲', '🏖️', '👨‍🍳', '🤝', '🎸', '🚢', '🌮', '🧗', '🌙', '🧁', '🥂',
  '🎓', '🛶', '🗺️', '🏛️', '🕌', '🌍', '✈️', '🗼', '🌊', '🏙️', '🌺', '🕍',
  '⛪', '🎯', '🃏', '♟️', '🎳', '🎮', '🪄', '🧩', '🎪', '🪂', '🧖', '🌸',
  '🫶', '🧠', '🫁', '🛍️', '🪸', '🌴', '🦋', '🐚', '🌻', '🍃', '🎋', '🌄',
  '🔥', '🏕️', '🍣', '🥘', '🧆', '🥗', '🍜', '🧋', '🍹', '🫖', '🏇', '🤿',
  '🧜', '🪁', '🏄', '🎠', '🎡', '⚽', '🏀', '🎾', '🏓', '🏐', '🥊', '🏆',
  '⛷️', '🪩', '🕺', '🎊', '🌃', '🎆', '🧿', '🏺', '🎹', '🎷', '🎺', '🥁',
  '🎻', '🏔️', '🌈', '🌠', '🐱', '🐾', '🐟', '🍕', '🍰', '🥐', '🍫', '🎞️',
  '🎥', '📽️', '🍿', '🧺', '🌳', '💻', '🖥️', '🌅',
]
