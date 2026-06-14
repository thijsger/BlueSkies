// Clean line icons in the Lucide visual language (24x24, stroke-based).
// No emojis in the core UI — these are injected as inline SVG.

const ICONS = {
  parachute: '<path d="M3 11a9 9 0 0 1 18 0"/><path d="M3 11 11 20"/><path d="M21 11 13 20"/><path d="M9 11l2 9"/><path d="M15 11l-2 9"/><path d="M11 20l1 2 1-2"/>',
  mountain: '<path d="M3 19 9 8l4 6 3-4 5 9z"/>',
  trendingDown: '<path d="M3 7l8 8 4-4 6 6"/><path d="M16 17h5v-5"/>',
  trendingUp: '<path d="M3 17l8-8 4 4 6-6"/><path d="M16 7h5v5"/>',
  heart: '<path d="M12 20s-7-4.7-9.3-9.2A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 9.3 4.8C19 15.3 12 20 12 20z"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/><circle cx="12" cy="18" r="1.2"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h14a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  navigation: '<path d="M12 2 19 21l-7-4-7 4z"/>',
  mapPin: '<path d="M12 22s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="11" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  plane: '<path d="M10 4c0-1 .5-2 2-2s2 1 2 2v5l7 4v2l-7-2v4l2 2v1l-4-1.2L8 20v-1l2-2v-4l-7 2v-2l7-4z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 9l5-5 5 5"/><path d="M12 4v12"/>',
  activity: '<path d="M22 12h-4l-3 9-6-18-3 9H2"/>',
  alert: '<path d="M12 3 22 20H2z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  save: '<path d="M5 3h11l5 5v13H5z"/><path d="M8 3v5h8"/><path d="M8 21v-7h8v7"/>',
  move: '<path d="M5 12h14"/><path d="M8 9l-3 3 3 3"/><path d="M16 9l3 3-3 3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20"/>',
  barChart: '<path d="M3 21h18"/><path d="M7 21V11"/><path d="M12 21V4"/><path d="M17 21v-7"/>',
  logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-3 4 3 4H5"/>',
  cube: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.5"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M8 5v14"/><path d="M16 5v14"/>',
  ruler: '<path d="M4 16 16 4l4 4L8 20z"/><path d="M9 9l1.5 1.5"/><path d="M12 6l1.5 1.5"/><path d="M6 12l1.5 1.5"/>',
  satellite: '<path d="M5 13a7 7 0 0 1 6-6"/><path d="M8 16a3 3 0 0 1 3-3"/><circle cx="13" cy="11" r="1"/><path d="M16 8l4-4"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>',
};

export function iconSVG(name, size = 18) {
  const body = ICONS[name] || ICONS.activity;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// returns a DOM span containing the icon
export function icon(name, size = 18, cls = "") {
  const span = document.createElement("span");
  span.className = "ic " + cls;
  span.innerHTML = iconSVG(name, size);
  return span;
}

// phase -> icon name
export const PHASE_ICON = {
  climb: "trendingUp",
  exit: "logOut",
  freefall: "trendingDown",
  canopy: "parachute",
  landed: "flag",
};
