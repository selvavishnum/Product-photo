// Tailwind v4 is configured in CSS (see app/globals.css), not in a
// tailwind.config.js. The only build-tool wiring needed is this plugin.
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
