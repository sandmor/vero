export const isProductionEnvironment = process.env.NODE_ENV === 'production';
export const isDevelopmentEnvironment = process.env.NODE_ENV === 'development';
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const guestRegex = /^guest-\d+$/;

// Single admin email (simple bootstrap). In future, move to roles/permissions table.
export const adminEmail = process.env.ADMIN_EMAIL || '';
// Optional stronger identifier for admin (Clerk user id). If set, it takes precedence.
export const adminUserId = process.env.ADMIN_USER_ID || '';
