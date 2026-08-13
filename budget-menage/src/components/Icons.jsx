/**
 * Icônes de navigation.
 *
 * Dessinées à la main plutôt que tirées d'une bibliothèque : six glyphes ne
 * valent pas une dépendance, et une bibliothèque d'icônes pèse plus lourd que
 * toute l'application. Le trait suit la grammaire d'SF Symbols — 24 unités,
 * contour de 1,7, extrémités arrondies — pour que l'ensemble s'accorde à la
 * police système qui l'entoure.
 *
 * `currentColor` partout : c'est l'état actif du lien qui décide de la teinte,
 * jamais l'icône.
 */

function Glyph({ children, label }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

/** Tableau de bord — l'anneau de répartition, en miniature. */
export const IconDashboard = (p) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 3.8v8.2l5.8 5.8" />
  </Glyph>
);

/** Écritures — les lignes d'un journal. */
export const IconLedger = (p) => (
  <Glyph {...p}>
    <path d="M4 6h10M4 12h10M4 18h7" />
    <path d="M18 5.5v13" />
    <path d="M16 8.5h4M16 15.5h4" />
  </Glyph>
);

/** Révision — ce qui reste à trancher. */
export const IconReview = (p) => (
  <Glyph {...p}>
    <path d="M20 12.2V6.4A2.4 2.4 0 0 0 17.6 4H6.4A2.4 2.4 0 0 0 4 6.4v11.2A2.4 2.4 0 0 0 6.4 20h5.8" />
    <path d="M8 9h8M8 13h5" />
    <path d="m15.5 17.6 2 2 3.5-3.9" />
  </Glyph>
);

/** Patrimoine — ce qui s'accumule. */
export const IconWealth = (p) => (
  <Glyph {...p}>
    <path d="M4 19.5h16" />
    <path d="M4 15.5 9.2 10l3.6 3.3L20 6" />
    <path d="M15.6 6H20v4.4" />
  </Glyph>
);

/** Import — le relevé qui entre. */
export const IconImport = (p) => (
  <Glyph {...p}>
    <path d="M12 3.5v10.8" />
    <path d="m8 10.6 4 4 4-4" />
    <path d="M4.5 15.5v2.6A2.4 2.4 0 0 0 6.9 20.5h10.2a2.4 2.4 0 0 0 2.4-2.4v-2.6" />
  </Glyph>
);

/** Tiers — une devanture de commerçant. */
export const IconPayees = (p) => (
  <Glyph {...p}>
    <path d="M4.6 9.5h14.8v8.6a1.9 1.9 0 0 1-1.9 1.9H6.5a1.9 1.9 0 0 1-1.9-1.9Z" />
    <path d="M3.4 9.5 5 4.6a.8.8 0 0 1 .8-.6h12.4a.8.8 0 0 1 .8.6l1.6 4.9" />
    <path d="M9.6 20v-5.2h4.8V20" />
  </Glyph>
);

/** Comptes — un portefeuille. */
export const IconWallet = (p) => (
  <Glyph {...p}>
    <path d="M4 7.6A2.1 2.1 0 0 1 6.1 5.5h9.8a2.1 2.1 0 0 1 2.1 2.1v.9" />
    <path d="M4 7.6v8.8A2.1 2.1 0 0 0 6.1 18.5h11.8a2.1 2.1 0 0 0 2.1-2.1v-5.8a1.2 1.2 0 0 0-1.2-1.2H5.2A1.2 1.2 0 0 1 4 8.2Z" />
    <circle cx="16.4" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
  </Glyph>
);

/** Plus — l'écran de débordement : révision, import, réglages. */
export const IconMore = (p) => (
  <Glyph {...p}>
    <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Glyph>
);

/** L'œil ouvert : les montants sont lisibles. */
export const IconEye = (p) => (
  <Glyph {...p}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.9" />
  </Glyph>
);

/** L'œil barré : les montants sont masqués. */
export const IconEyeOff = (p) => (
  <Glyph {...p}>
    <path d="M9.9 5.9A8.6 8.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a16 16 0 0 1-2.6 3.3" />
    <path d="M6.4 7.4A15.7 15.7 0 0 0 2.5 12S6 18.2 12 18.2a8.9 8.9 0 0 0 3.7-.78" />
    <path d="m10 10.1a2.9 2.9 0 0 0 4 4" />
    <path d="m3.5 3.5 17 17" />
  </Glyph>
);

/** Le chevron des lignes de menu. */
export const IconChevron = (p) => (
  <Glyph {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Glyph>
);

/** Réglages. */
export const IconSettings = (p) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 14.4a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.84 2.84l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.84-2.84l.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.84-2.84l.06.06a1.7 1.7 0 0 0 1.88.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.84 2.84l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1.03Z" />
  </Glyph>
);
