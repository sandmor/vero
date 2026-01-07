/**
 * Configuration constants for the web scraping API.
 * Based on Firecrawl's API capabilities, providing web scraping,
 * crawling, mapping, search, and structured data extraction.
 */

export const WEB_API_CONFIG = {
    /** Base URL for the web scraping service */
    BASE_URL: process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev',

    /** API key for authentication */
    API_KEY: process.env.FIRECRAWL_API_KEY || '',

    /** Maximum timeout for scrape requests in milliseconds */
    SCRAPE_TIMEOUT_MS: 30_000,

    /** Maximum timeout for crawl requests in milliseconds */
    CRAWL_TIMEOUT_MS: 60_000,

    /** Maximum timeout for map requests in milliseconds */
    MAP_TIMEOUT_MS: 30_000,

    /** Maximum timeout for search requests in milliseconds */
    SEARCH_TIMEOUT_MS: 30_000,

    /** Default scrape formats */
    DEFAULT_SCRAPE_FORMATS: ['markdown'] as const,

    /** Maximum pages to crawl by default */
    DEFAULT_CRAWL_LIMIT: 10,

    /** Maximum pages allowed to crawl */
    MAX_CRAWL_LIMIT: 50,

    /** Maximum search results by default */
    DEFAULT_SEARCH_LIMIT: 5,

    /** Maximum search results allowed */
    MAX_SEARCH_LIMIT: 10,

    /** Maximum map URLs by default */
    DEFAULT_MAP_LIMIT: 100,

    /** Maximum map URLs allowed */
    MAX_MAP_LIMIT: 500,

    /** Maximum depth for crawling */
    MAX_CRAWL_DEPTH: 5,

    /** Default cache max age in milliseconds (2 days) */
    DEFAULT_MAX_AGE_MS: 172_800_000,

    /** Maximum response content length in characters for markdown (2MB) */
    MAX_MARKDOWN_LENGTH: 2_000_000,

    /** Maximum JSON extraction schema depth */
    MAX_SCHEMA_DEPTH: 4,

    /** Retry settings */
    RETRY: {
        /** Number of retry attempts */
        MAX_RETRIES: 2,
        /** Initial delay between retries in milliseconds */
        INITIAL_DELAY_MS: 1_000,
        /** Multiplier for exponential backoff */
        BACKOFF_MULTIPLIER: 2,
    },
} as const;

export type WebApiConfig = typeof WEB_API_CONFIG;
