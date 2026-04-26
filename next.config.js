/** @type {import('next').NextConfig} */
module.exports = {
  watchOptions: {
    ignored: ['**/.playwright-mcp/**', '**/screenshots/**', '**/.git/**'],
  },
}
