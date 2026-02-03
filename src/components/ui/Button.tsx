// Reusable Button component with modern styling
type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  icon?: React.ReactNode;
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  className = '',
  icon,
}: ButtonProps) {
  const baseStyles = `
    inline-flex items-center justify-center gap-2
    font-semibold rounded-xl
    transition-all duration-200
    focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-900
    active:scale-[0.98]
  `;
  
  const variantStyles = {
    primary: `
      bg-gradient-to-r from-blue-600 to-blue-700 text-white
      hover:from-blue-700 hover:to-blue-800
      focus:ring-blue-500
      shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40
    `,
    secondary: `
      bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200
      hover:bg-gray-200 dark:hover:bg-gray-600
      focus:ring-gray-500
    `,
    success: `
      bg-gradient-to-r from-emerald-500 to-teal-600 text-white
      hover:from-emerald-600 hover:to-teal-700
      focus:ring-emerald-500
      shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40
    `,
    danger: `
      bg-gradient-to-r from-red-500 to-rose-600 text-white
      hover:from-red-600 hover:to-rose-700
      focus:ring-red-500
      shadow-lg shadow-red-500/25 hover:shadow-red-500/40
    `,
    outline: `
      border-2 border-blue-500 text-blue-600 dark:text-blue-400
      hover:bg-blue-50 dark:hover:bg-blue-900/20
      focus:ring-blue-500
    `,
    ghost: `
      text-gray-600 dark:text-gray-400
      hover:bg-gray-100 dark:hover:bg-gray-800
      hover:text-gray-900 dark:hover:text-white
      focus:ring-gray-500
    `,
  };
  
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
    icon: 'p-2.5',
  };
  
  const disabledStyles = disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer';
  
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabledStyles} ${className}`}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
