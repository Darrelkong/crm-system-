import { cn } from "@/lib/cn";

const inputClass =
  "surface-input w-full px-3.5 py-2.5 text-sm text-[#172033] placeholder:text-[#6B7890]";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(inputClass, "min-h-[100px] resize-y", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, className)} {...props}>
      {children}
    </select>
  );
}

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-sm font-medium text-[#172033]", className)}
      {...props}
    >
      {children}
    </label>
  );
}

export function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-5">{children}</div>;
}
