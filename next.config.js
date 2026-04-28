/** @type {import('next').NextConfig} */
module.exports = {
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        '**/.playwright-mcp/**',
        '**/screenshots/**',
        '**/.git/**',
        '**/node_modules/**',
      ],
    }
    return config
  },
}
