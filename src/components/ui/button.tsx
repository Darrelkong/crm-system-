import { cn } from "@/lib/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
};

const variants = {
  primary:
    "primary-button bg-[#2F6FB3] text-white hover:bg-[#255A91] active:bg-[#1F4E79] shadow-[0_2px_8px_rgba(47,111,179,0.28)] hover:-translate-y-px",
  secondary: "secondary-button",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  ghost: "text-[#6B7890] hover:bg-[#E8F1FA] hover:text-[#172033]",
};

const sizes = {
  sm: "min-h-9 px-3 py-1.5 text-sm rounded-xl",
  md: "min-h-11 px-4 py-2.5 text-sm rounded-xl",
  lg: "min-h-12 px-5 py-3 text-base rounded-xl",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
