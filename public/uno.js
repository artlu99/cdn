// Theme switching based on system preferences
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function updateTheme(e) {
    document.documentElement.setAttribute('data-theme', e.matches ? 'forest' : 'bumblebee');
}

// Set initial theme
updateTheme(prefersDark);

// Listen for system theme changes
prefersDark.addEventListener('change', updateTheme);

// UnoCSS configuration
window.__unocss = {
    presets: [
        window.__unocss_preset_typography,
        window.__unocss_preset_icons,
    ],
    theme: {
        colors: {
            primary: 'hsl(var(--p))',
            'primary-focus': 'hsl(var(--pf))',
            'primary-content': 'hsl(var(--pc))',
            secondary: 'hsl(var(--s))',
            'secondary-focus': 'hsl(var(--sf))',
            'secondary-content': 'hsl(var(--sc))',
            accent: 'hsl(var(--a))',
            'accent-focus': 'hsl(var(--af))',
            'accent-content': 'hsl(var(--ac))',
            neutral: 'hsl(var(--n))',
            'neutral-focus': 'hsl(var(--nf))',
            'neutral-content': 'hsl(var(--nc))',
            'base-100': 'hsl(var(--b1))',
            'base-200': 'hsl(var(--b2))',
            'base-300': 'hsl(var(--b3))',
            'base-content': 'hsl(var(--bc))',
            info: 'hsl(var(--in))',
            success: 'hsl(var(--su))',
            warning: 'hsl(var(--wa))',
            error: 'hsl(var(--er))',
        },
    },
    shortcuts: {
        'btn': 'btn btn-primary',
        'btn-ghost': 'btn btn-ghost',
        'btn-error': 'btn btn-error',
        'card': 'card bg-base-100 shadow-xl',
    },
} 