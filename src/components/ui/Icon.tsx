import { clsx } from "clsx";

export function Icon({
  name,
  filled = false,
  className,
  "aria-hidden": ariaHidden = true,
}: {
  name: string;
  filled?: boolean;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={clsx("material-symbols-outlined select-none", filled && "icon-filled", className)}
    >
      {name}
    </span>
  );
}
