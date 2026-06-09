interface IconProps {
  name: string;
  className?: string;
}

export function Icon({ name, className = '' }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={`iconfont icon-${name} inline-flex h-[1em] w-[1em] shrink-0 items-center justify-center align-middle leading-none ${className}`.trim()}
    />
  );
}
