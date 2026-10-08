const paths = {
  power: 'M12 3v9 M6.4 6.4a8 8 0 1 0 11.2 0',
  monitor: 'M3 4h18v12H3z M8 20h8 M12 16v4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z',
  unplug: 'M7 17l-4 4 M17 7l4-4 M9 11l-2 2a3.5 3.5 0 0 0 5 5l2-2 M15 13l2-2a3.5 3.5 0 0 0-5-5l-2 2 M3 3l18 18',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z M13.2 12.7 21 20.5 M17.5 17l2-2 M19.5 19l1.5-1.5',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3Z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  terminal: 'M4 5h16v14H4z M8 10l2 2-2 2 M12 15h4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  eyeOff: 'M3 3l18 18 M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3 3.9 M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  check: 'M4 12.5l5 5L20 6.5',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  save: 'M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  x: 'M6 6l12 12 M18 6 6 18',
  plus: 'M12 5v14 M5 12h14',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4',
  alert: 'M12 4 2.5 20h19L12 4Z M12 10v4 M12 17h.01',
  upload: 'M12 20V9 M7 14l5-5 5 5 M5 4h14',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
