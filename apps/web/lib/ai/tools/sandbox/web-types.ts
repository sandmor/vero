/**
 * TypeScript types for web scraping API operations.
 * Provides a clean, well-documented interface for web data extraction.
 */

// ============================================================================
// Scrape Types
// ============================================================================

/** Basic format types for scraping */
export type ScrapeFormatBasic =
  | 'markdown'
  | 'html'
  | 'rawHtml'
  | 'links'
  | 'screenshot'
  | 'images';

/** JSON extraction format with optional schema or prompt */
export interface ScrapeFormatJson {
  type: 'json';
  /** JSON Schema for structured output (optional) */
  schema?: Record<string, unknown>;
  /** Prompt to guide extraction when schema is not provided */
  prompt?: string;
}

/** Screenshot format with options */
export interface ScrapeFormatScreenshot {
  type: 'screenshot';
  /** Capture full page screenshot */
  fullPage?: boolean;
}

/** Union of all format types */
export type ScrapeFormat =
  | ScrapeFormatBasic
  | ScrapeFormatJson
  | ScrapeFormatScreenshot;

/** Action types for interacting with pages before scraping */
export type ScrapeActionType =
  | 'wait'
  | 'click'
  | 'write'
  | 'press'
  | 'scroll'
  | 'screenshot'
  | 'scrape';

/** Wait action - pauses execution */
export interface ScrapeActionWait {
  type: 'wait';
  /** Milliseconds to wait */
  milliseconds: number;
}

/** Click action - clicks an element */
export interface ScrapeActionClick {
  type: 'click';
  /** CSS selector for the element to click */
  selector: string;
}

/** Write action - types text */
export interface ScrapeActionWrite {
  type: 'write';
  /** Text to type */
  text: string;
  /** Optional selector to focus before typing */
  selector?: string;
}

/** Press action - presses a key */
export interface ScrapeActionPress {
  type: 'press';
  /** Key to press (e.g., 'Enter', 'Tab', 'Escape') */
  key: string;
}

/** Scroll action - scrolls the page */
export interface ScrapeActionScroll {
  type: 'scroll';
  /** Direction to scroll */
  direction?: 'up' | 'down';
  /** Pixels to scroll */
  amount?: number;
  /** Selector to scroll within */
  selector?: string;
}

/** Screenshot action - takes a screenshot during action sequence */
export interface ScrapeActionScreenshot {
  type: 'screenshot';
  /** Capture full page screenshot */
  fullPage?: boolean;
}

/** Union of all action types */
export type ScrapeAction =
  | ScrapeActionWait
  | ScrapeActionClick
  | ScrapeActionWrite
  | ScrapeActionPress
  | ScrapeActionScroll
  | ScrapeActionScreenshot;

/** Location settings for scraping */
export interface ScrapeLocation {
  /** ISO 3166-1 alpha-2 country code (e.g., 'US', 'GB', 'DE') */
  country?: string;
  /** Preferred languages (e.g., ['en', 'es']) */
  languages?: string[];
}

/** Options for the scrape operation */
export interface ScrapeOptions {
  /** Output formats to retrieve */
  formats?: ScrapeFormat[];
  /** Actions to perform before scraping */
  actions?: ScrapeAction[];
  /** Location and language settings */
  location?: ScrapeLocation;
  /** Only extract main content (excludes headers, footers, etc.) */
  onlyMainContent?: boolean;
  /** Include tags to keep in HTML/markdown (CSS selectors) */
  includeTags?: string[];
  /** Exclude tags from HTML/markdown (CSS selectors) */
  excludeTags?: string[];
  /** Wait for specific selector before scraping */
  waitFor?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Proxy strategy: 'basic' | 'stealth' | 'auto' */
  proxy?: 'basic' | 'stealth' | 'auto';
  /** Maximum cache age in milliseconds (0 for fresh) */
  maxAge?: number;
}

/** Metadata returned from scraping */
export interface ScrapeMetadata {
  title?: string;
  description?: string;
  language?: string;
  keywords?: string;
  robots?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogUrl?: string;
  ogImage?: string;
  ogSiteName?: string;
  sourceURL: string;
  statusCode: number;
}

/** Action results (screenshots taken, scrapes performed) */
export interface ScrapeActionResults {
  screenshots?: string[];
  scrapes?: Array<{ url: string; html?: string }>;
}

/** Result from a scrape operation */
export interface ScrapeResult {
  /** Markdown content (if requested) */
  markdown?: string;
  /** HTML content (if requested) */
  html?: string;
  /** Raw HTML content (if requested) */
  rawHtml?: string;
  /** Extracted links (if requested) */
  links?: string[];
  /** Screenshot URL (if requested) */
  screenshot?: string;
  /** Extracted image URLs (if requested) */
  images?: string[];
  /** Structured JSON data (if json format requested) */
  json?: Record<string, unknown>;
  /** Page metadata */
  metadata: ScrapeMetadata;
  /** Results from actions performed */
  actions?: ScrapeActionResults;
}

// ============================================================================
// Crawl Types
// ============================================================================

/** Options for the crawl operation */
export interface CrawlOptions {
  /** Maximum number of pages to crawl */
  limit?: number;
  /** Maximum depth to crawl */
  maxDepth?: number;
  /** Output formats for each page */
  formats?: ScrapeFormat[];
  /** URL patterns to include (regex strings) */
  includePaths?: string[];
  /** URL patterns to exclude (regex strings) */
  excludePaths?: string[];
  /** Only crawl same-origin URLs */
  sameOrigin?: boolean;
  /** Allow backward links */
  allowBackwardLinks?: boolean;
  /** Allow external links */
  allowExternalLinks?: boolean;
  /** Location and language settings */
  location?: ScrapeLocation;
}

/** Status of a crawl job */
export type CrawlStatus = 'scraping' | 'completed' | 'failed' | 'cancelled';

/** Result from a crawl operation */
export interface CrawlResult {
  /** Current status */
  status: CrawlStatus;
  /** Total pages found */
  total: number;
  /** Pages completed */
  completed: number;
  /** Credits used */
  creditsUsed: number;
  /** Expiration timestamp */
  expiresAt?: string;
  /** URL for next page of results (pagination) */
  next?: string;
  /** Scraped page data */
  data: ScrapeResult[];
}

// ============================================================================
// Map Types
// ============================================================================

/** Options for the map operation */
export interface MapOptions {
  /** Search term to filter URLs */
  search?: string;
  /** Maximum number of URLs to return */
  limit?: number;
  /** Include subdomains */
  includeSubdomains?: boolean;
  /** Ignore sitemap */
  ignoreSitemap?: boolean;
}

/** Result from a map operation */
export interface MapResult {
  /** List of discovered URLs */
  urls: string[];
}

// ============================================================================
// Search Types
// ============================================================================

/** Options for the search operation */
export interface SearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Country code for search location */
  country?: string;
  /** Language code for results */
  language?: string;
  /** Scrape options for search results */
  scrapeOptions?: Omit<ScrapeOptions, 'actions'>;
}

/** A single web search result */
export interface SearchResultItem {
  url: string;
  title: string;
  description?: string;
  position: number;
  /** Scraped content (if scrapeOptions provided) */
  markdown?: string;
  html?: string;
}

/** Image search result */
export interface SearchImageResult {
  title: string;
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  url: string;
  position: number;
}

/** News search result */
export interface SearchNewsResult {
  title: string;
  url: string;
  snippet?: string;
  date?: string;
  position: number;
}

/** Result from a search operation */
export interface SearchResult {
  /** Web search results */
  web?: SearchResultItem[];
  /** Image search results */
  images?: SearchImageResult[];
  /** News search results */
  news?: SearchNewsResult[];
}

// ============================================================================
// Simplified Types for Sandbox API
// ============================================================================

/** Simplified scrape options for sandbox use */
export interface WebScrapeParams {
  /** URL to scrape */
  url: string;
  /** Output formats (default: ['markdown']) */
  formats?: Array<'markdown' | 'html' | 'links' | 'screenshot' | 'json'>;
  /** JSON extraction schema (when format includes 'json') */
  jsonSchema?: Record<string, unknown>;
  /** JSON extraction prompt (when format includes 'json') */
  jsonPrompt?: string;
  /** Actions to perform before scraping */
  actions?: ScrapeAction[];
  /** Wait for selector before scraping */
  waitFor?: string;
  /** Only extract main content */
  onlyMainContent?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

/** Simplified crawl options for sandbox use */
export interface WebCrawlParams {
  /** Starting URL to crawl */
  url: string;
  /** Maximum pages to crawl (default: 10, max: 50) */
  limit?: number;
  /** Maximum depth (default: 3, max: 5) */
  maxDepth?: number;
  /** Output formats for each page */
  formats?: Array<'markdown' | 'html' | 'links'>;
  /** URL patterns to include (regex strings) */
  includePaths?: string[];
  /** URL patterns to exclude (regex strings) */
  excludePaths?: string[];
}

/** Simplified map options for sandbox use */
export interface WebMapParams {
  /** URL to map */
  url: string;
  /** Search term to filter URLs */
  search?: string;
  /** Maximum URLs to return (default: 100, max: 500) */
  limit?: number;
  /** Include subdomains */
  includeSubdomains?: boolean;
}

/** Simplified search options for sandbox use */
export interface WebSearchParams {
  /** Search query */
  query: string;
  /** Maximum results (default: 5, max: 10) */
  limit?: number;
  /** Country code for location */
  country?: string;
  /** Language code */
  language?: string;
  /** Whether to scrape result pages for full content */
  scrapeResults?: boolean;
}

/** Simplified scrape result for sandbox */
export interface WebScrapeResult {
  /** Markdown content */
  markdown?: string;
  /** HTML content */
  html?: string;
  /** Extracted links */
  links?: string[];
  /** Screenshot URL */
  screenshot?: string;
  /** Extracted JSON data */
  json?: Record<string, unknown>;
  /** Page title */
  title?: string;
  /** Page description */
  description?: string;
  /** Source URL */
  sourceUrl: string;
  /** HTTP status code */
  statusCode: number;
}

/** Simplified crawl result for sandbox */
export interface WebCrawlResult {
  /** Status of the crawl */
  status: CrawlStatus;
  /** Total pages found */
  total: number;
  /** Pages completed */
  completed: number;
  /** Scraped pages */
  pages: WebScrapeResult[];
}

/** Simplified map result for sandbox */
export interface WebMapResult {
  /** Discovered URLs */
  urls: string[];
  /** Total URLs found */
  total: number;
}

/** Simplified search result for sandbox */
export interface WebSearchResult {
  /** Web results */
  results: Array<{
    url: string;
    title: string;
    description?: string;
    /** Full markdown content (if scrapeResults enabled) */
    markdown?: string;
  }>;
  /** Total results returned */
  total: number;
}
