/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                primary: "#FF2E4D",
                "primary-dark": "#D61C38",
                "background-light": "#F3F4F6",
                "background-dark": "#0A0E17",
                "surface-light": "#FFFFFF",
                "surface-dark": "#151B2C",
                "surface-darker": "#0F1419",
                "text-light": "#F8FAFC",
                "text-dark": "#F8FAFC",
                "muted-light": "#9CA3AF",
                "muted-dark": "#64748B",
                "success": "#10B981",
                "pending": "#3B82F6",
            },
            fontFamily: {
                sans: ["Barlow", "sans-serif"],
                display: ["Rajdhani", "sans-serif"],
            },
            borderRadius: {
                'xl': '1rem',
                '2xl': '1.5rem',
            },
            boxShadow: {
                'glow': '0 0 20px rgba(255, 46, 77, 0.3)',
                'glow-lg': '0 0 30px rgba(255, 46, 77, 0.4)',
                'card': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
                'card-hover': '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
            },
            animation: {
                'fade-in': 'fadeIn 0.3s ease-in-out',
                'slide-up': 'slideUp 0.4s ease-out',
                'slide-down': 'slideDown 0.4s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
                'glow-pulse': 'glowPulse 2s ease-in-out infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                slideDown: {
                    '0%': { transform: 'translateY(-10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                scaleIn: {
                    '0%': { transform: 'scale(0.95)', opacity: '0' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                },
                glowPulse: {
                    '0%, 100%': { boxShadow: '0 0 20px rgba(255, 46, 77, 0.3)' },
                    '50%': { boxShadow: '0 0 30px rgba(255, 46, 77, 0.5)' },
                },
            },
        },
    },
    plugins: [],
}
