// 🏷️ TAG COMPONENT
// Componente reutilizable para tags/etiquetas de información

import React from 'react';

interface TagProps {
    children: React.ReactNode;
    icon?: string;
    variant?: 'default' | 'outlined' | 'solid';
    color?: string;
    className?: string;
}

const Tag: React.FC<TagProps> = ({
    children,
    icon,
    variant = 'default',
    color,
    className = '',
}) => {
    const variantStyles = {
        default: 'bg-background-dark/70 text-gray-300 border-gray-800',
        outlined: 'bg-transparent border-gray-700 text-gray-300',
        solid: 'bg-surface-darker text-white border-gray-700',
    };

    return (
        <span
            className={`
                inline-flex items-center gap-1.5
                px-3 py-1.5 rounded-lg border
                text-xs font-medium backdrop-blur-sm
                transition-all duration-300
                hover:border-primary/30
                ${variantStyles[variant]}
                ${className}
            `}
            style={color ? { borderColor: color + '40', color } : {}}
        >
            {icon && (
                <span className="material-icons-round text-sm">
                    {icon}
                </span>
            )}
            {children}
        </span>
    );
};

export default Tag;
