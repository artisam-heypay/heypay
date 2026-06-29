// Floating-label input per BRAND §7 (peer + label transform; visible focus ring).
type Props = {
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
};

export function FloatingInput({ id, name, label, type = "text", autoComplete, required }: Props) {
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder=" "
        className="peer w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-4 pt-6 pb-2 text-body-md text-on-surface outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-4 text-on-surface-variant transition-all peer-focus:top-2 peer-focus:text-label-md peer-focus:text-primary peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-label-md"
      >
        {label}
      </label>
    </div>
  );
}
