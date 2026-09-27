import type { ReactNode, SVGProps } from 'react';

type IconProps = { size?: number; className?: string };

function Svg({ size = 20, className, children, ...rest }: IconProps & { children: ReactNode } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function LeafIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 19c8 0 12-7 13-14-7 1-14 5-13 14Z" />
      <path d="M8 16c2-2.5 4.5-4.5 8-6" />
    </Svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M18 6l-1.3 1.3M7.3 16.7 6 18" />
    </Svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21.5Z" />
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 8H20" />
    </Svg>
  );
}

export function WeekIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="10" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="16.5" y="4.5" width="4" height="15" rx="1.2" />
    </Svg>
  );
}

export function HorizonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 17.5h17" />
      <path d="M6.5 17.5a5.5 5.5 0 0 1 11 0" />
      <path d="M12 8.2V4.8M9.2 9.4 7.4 7.6M14.8 9.4l1.8-1.8" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3.5V7M16 3.5V7M3.5 10h17" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12.2 2.3 2.3 4.7-5" />
    </Svg>
  );
}

export function DotsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 20V4.5" />
      <path d="M6 5h11l-2 3.5 2 3.5H6" />
    </Svg>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.8V9h5M8.5 13h7M8.5 16.5h5" />
    </Svg>
  );
}

export function ArcIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 16a7 7 0 0 1 14 0" />
      <path d="M12 16V9" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14.5 6-6 6 6 6" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m7 7 10 10M17 7 7 17" />
    </Svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13 7 4 4" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 7.5h14" />
      <path d="M9.5 7.5V5.8A1.3 1.3 0 0 1 10.8 4.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="m7.2 7.5.7 11.2A1.5 1.5 0 0 0 9.4 20h5.2a1.5 1.5 0 0 0 1.5-1.3l.7-11.2" />
    </Svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function TickIcon(props: IconProps) {
  return (
    <Svg {...props} strokeWidth="2.2">
      <path d="m6 12.5 3.8 3.8L18 8" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5v10" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19.5h14" />
    </Svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19.5v-10" />
      <path d="m8 9 4-4 4 4" />
      <path d="M5 19.5h14" />
    </Svg>
  );
}

export function WaterIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5s6 6.2 6 10.2a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5Z" />
    </Svg>
  );
}

export function StudyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8 12 4.5 20.5 8 12 11.5 3.5 8Z" />
      <path d="M7 10.2v4.2c1.6 1.2 3.2 1.8 5 1.8s3.4-.6 5-1.8v-4.2" />
    </Svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15.5 3.8A8 8 0 1 0 20 14.2 6.2 6.2 0 0 1 15.5 3.8Z" />
    </Svg>
  );
}

export function WalkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="14" cy="5" r="1.4" />
      <path d="m8 21 2.2-5.2L8 12.5l3-2 2.2 2.2 2.3-1.2" />
      <path d="m11 10.5-2.2 2" />
    </Svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19.5s-6.5-4.1-6.5-8.2A3.4 3.4 0 0 1 12 8.8a3.4 3.4 0 0 1 6.5 2.5c0 4.1-6.5 8.2-6.5 8.2Z" />
    </Svg>
  );
}

export function CoffeeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 8.5h11v5.2A4.3 4.3 0 0 1 11.7 18H9.3A4.3 4.3 0 0 1 5 13.7Z" />
      <path d="M16 9.5h1.8a2.2 2.2 0 0 1 0 4.4H16" />
      <path d="M8 4.8c0 1-.6 1.2-.6 2M11 4.8c0 1-.6 1.2-.6 2" />
    </Svg>
  );
}

export function PencilDrawIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 6.5 17.5 11 8 20.5H3.5V16Z" />
      <path d="m12 7.5 2 2" />
    </Svg>
  );
}

export function StretchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="5" r="1.4" />
      <path d="M12 8.2v5.2M8 11.2l4-3 4 3M8.5 20.2 12 13.4l3.5 6.8" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 13.4 9 19 10.5 13.4 12 12 17.5 10.6 12 5 10.5 10.6 9Z" />
    </Svg>
  );
}

export function HabitGlyph({ name, size = 18 }: { name: string; size?: number }) {
  switch (name) {
    case 'water':
      return <WaterIcon size={size} />;
    case 'book':
      return <BookIcon size={size} />;
    case 'study':
      return <StudyIcon size={size} />;
    case 'moon':
      return <MoonIcon size={size} />;
    case 'sun':
      return <SunIcon size={size} />;
    case 'walk':
      return <WalkIcon size={size} />;
    case 'heart':
      return <HeartIcon size={size} />;
    case 'coffee':
      return <CoffeeIcon size={size} />;
    case 'pencil':
      return <PencilDrawIcon size={size} />;
    case 'stretch':
      return <StretchIcon size={size} />;
    case 'spark':
      return <SparkIcon size={size} />;
    default:
      return <LeafIcon size={size} />;
  }
}
