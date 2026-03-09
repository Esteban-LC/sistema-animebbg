// 🎨 BADGE COMPONENT
// Componente reutilizable para badges/etiquetas con diferentes variantes

import React from 'react';

interface BadgeProps {
    children: React.ReactNode;
    variant?: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'gray';
    size?: 'sm' | 'md' | 'lg';
    icon?: string;
    withGlow?: boolean;
    className?: string;
}

const Badge: React.FC<BadgeProps> = ({
    children,
    variant = 'gray',
    size = 'md',
    icon,
    withGlow = false,
    className = '',
}) => {
    const variantStyles = {
        primary: 'bg-primary/10 text-primary border-primary/20',
        success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        warning: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
        error: 'bg-red-500/10 text-red-500 border-red-500/20',
        info: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        gray: 'bg-gray-700/30 text-gray-300 border-gray-700/50',
    };

    const sizeStyles = {
        sm: 'px-2 py-0.5 text-[10px]',
        md: 'px-3 py-1 text-xs',
        lg: 'px-4 py-1.5 text-sm',
    };

    const iconSizes = {
        sm: 'text-xs',
        md: 'text-sm',
        lg: 'text-base',
    };

    const glowStyles = withGlow ? 'shadow-glow' : '';

    return (
        <span
            className={`
                inline-flex items-center gap-1.5
                rounded-lg border font-bold uppercase tracking-wider
                backdrop-blur-sm transition-all duration-300
                ${variantStyles[variant]}
                ${sizeStyles[size]}
                ${glowStyles}
                ${className}
            `}
        >
            {icon && (
                <span className={`material-icons-round ${iconSizes[size]}`}>
                    {icon}
                </span>
            )}
            {children}
        </span>
    );
};

export default Badge;
