/**
 * The three glyphs that ride the dashed ring.
 *
 * Drawn here rather than imported, for the same reason the isologo is traced:
 * an icon font is a network request and a licence, and these are three shapes.
 * They are stroked in `currentColor` and sized by their container, so the disc
 * underneath decides the ink and the ring decides the size — which is what lets
 * one set of paths serve a brand that prints them on orange and a brand that
 * prints them on violet without a second copy.
 *
 * The construction is quoted rather than invented: that company's own badges
 * are a single white shape on a filled disc, no outline, no second colour, no
 * detail below about a millimetre. Anything finer disappears at the size these
 * are actually seen.
 */

const OPEN =
  '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'

/** A finger coming down on a screen: the gesture the whole product is made of. */
export const TAP =
  OPEN +
  '<path d="M14.4 16.6V8.6a2.4 2.4 0 0 1 4.8 0v8.2"/>' +
  '<path d="M19.2 14.7a2.2 2.2 0 0 1 4.4 0v5.8c0 3.6-2.9 6.6-6.6 6.6h-1.4c-2.1 0-4.1-1.1-5.2-3l-3-5.1a2.2 2.2 0 0 1 3.6-2.5l2.4 2.9"/>' +
  '</svg>'

/** Money that is looked after. Their own badge is a shield and nothing else. */
export const SHIELD =
  OPEN +
  '<path d="M16 4.2 6.4 7.9v7.4c0 6 3.9 10.4 9.6 12.1 5.7-1.7 9.6-6.1 9.6-12.1V7.9Z"/>' +
  '<path d="M13.4 20.6v-8h3.9a2.6 2.6 0 0 1 0 5.2h-3.5"/>' +
  '</svg>'

/** The payoff, and the only one of the three that is allowed to be cheerful. */
export const SPARK =
  OPEN +
  '<path d="M6.6 26.4 12 13.9l6.6 6.6Z"/>' +
  '<path d="M21.6 8.8h.02M26.6 13.8h.02M20.8 15.6h.02M25.6 7h.02" stroke-width="3.2"/>' +
  '</svg>'

/* The three below do not ride the ring. They are the motif that sits in the
   bottom corner of each figure card, where the reference publishes a small
   illustration — a person with a card, two phones, a card, a shopfront, a hand
   holding a phone. Those are drawn artwork nobody has here, and inventing a
   lookalike of somebody's illustration is worse than not having it, so what
   goes in that corner is this page's own vocabulary at the same size and a
   sixth of the ink: the same three-stroke construction as the badges, saying
   the same thing the card says, and never pretending to be their drawing. */

/** A card, seen flat. The one object this whole page is about. */
export const CARD =
  OPEN +
  '<rect x="3.6" y="7.4" width="24.8" height="17.2" rx="3.2"/>' +
  '<path d="M3.6 13.2h24.8"/>' +
  '<path d="M7.6 19.4h5.2"/>' +
  '</svg>'

/** A phone. Where the account actually lives. */
export const PHONE =
  OPEN +
  '<rect x="9.4" y="3.4" width="13.2" height="25.2" rx="3.2"/>' +
  '<path d="M14.2 25.2h3.6"/>' +
  '</svg>'

/** A shopfront, awning and all: the other end of every payment. */
export const STORE =
  OPEN +
  '<path d="M5.4 13.2v13.4h21.2V13.2"/>' +
  '<path d="M3.4 13.2 5.6 7h20.8l2.2 6.2Z"/>' +
  '<path d="M13 26.6v-7.2h6v7.2"/>' +
  '</svg>'
