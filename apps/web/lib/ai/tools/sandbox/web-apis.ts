/**
 * External web API services for web scraping, crawling, mapping, and searching.
 * Provides a clean interface for interacting with web content.
 */

import { WEB_API_CONFIG } from './web-config';
import {
    WebScrapeError,
    WebCrawlError,
    WebMapError,
    WebSearchError,
    TimeoutError,
    ValidationError,
} from './errors';
import type {
    WebScrapeParams,
    WebCrawlParams,
    WebMapParams,
    WebSearchParams,
    WebScrapeResult,
    WebCrawlResult,
    WebMapResult,
    WebSearchResult,
    ScrapeFormat,
    ScrapeAction,
} from './web-types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validates a URL for web operations
 */
function validateUrl(urlString: string, operation: string): URL {
    if (!urlString || typeof urlString !== 'string') {
        throw new ValidationError(`URL is required for ${operation} operation`);
    }

    let url: URL;
    try {
        url = new URL(urlString);
    } catch {
        throw new ValidationError(`Invalid URL: ${urlString}`);
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new ValidationError(
            `Protocol not allowed: ${url.protocol}. Only http and https are supported.`
        );
    }

    return url;
}

/**
 * Builds headers for API requests
 */
function buildHeaders(): Record<string, string> {
    const apiKey = WEB_API_CONFIG.API_KEY;
    if (!apiKey) {
        throw new ValidationError(
            'Web API key is not configured. Please set FIRECRAWL_API_KEY environment variable.'
        );
    }

    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
    };
}

/**
 * Makes an API request with timeout and error handling
 */
async function makeRequest<T>(
    endpoint: string,
    body: unknown,
    timeoutMs: number,
    operation: string
): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${WEB_API_CONFIG.BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        const data = await response.json();

        if (!response.ok || data.success === false) {
            const errorMessage =
                data.error || data.message || `${operation} request failed`;
            throw createOperationError(
                operation,
                errorMessage,
                response.status,
                body && typeof body === 'object' && 'url' in body
                    ? String(body.url)
                    : undefined
            );
        }

        return data;
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new TimeoutError(timeoutMs);
        }
        if (
            error instanceof ValidationError ||
            error instanceof WebScrapeError ||
            error instanceof WebCrawlError ||
            error instanceof WebMapError ||
            error instanceof WebSearchError
        ) {
            throw error;
        }
        throw createOperationError(
            operation,
            error instanceof Error ? error.message : 'Request failed',
            undefined,
            body && typeof body === 'object' && 'url' in body
                ? String(body.url)
                : undefined
        );
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Creates the appropriate error type for an operation
 */
function createOperationError(
    operation: string,
    message: string,
    statusCode?: number,
    url?: string
): Error {
    switch (operation) {
        case 'scrape':
            return new WebScrapeError(message, statusCode, url);
        case 'crawl':
            return new WebCrawlError(message, statusCode, url);
        case 'map':
            return new WebMapError(message, statusCode, url);
        case 'search':
            return new WebSearchError(message, statusCode);
        default:
            return new ValidationError(message);
    }
}

/**
 * Truncates content to maximum length
 */
function truncateContent(
    content: string | undefined,
    maxLength: number
): string | undefined {
    if (!content) return content;
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '\n\n[Content truncated...]';
}

/**
 * Converts simplified formats to Firecrawl format objects
 */
function buildFormats(
    formats: Array<'markdown' | 'html' | 'links' | 'screenshot' | 'json'>,
    jsonSchema?: Record<string, unknown>,
    jsonPrompt?: string
): ScrapeFormat[] {
    return formats.map((format) => {
        if (format === 'json') {
            const jsonFormat: { type: 'json'; schema?: Record<string, unknown>; prompt?: string } = {
                type: 'json',
            };
            if (jsonSchema) {
                jsonFormat.schema = jsonSchema;
            }
            if (jsonPrompt) {
                jsonFormat.prompt = jsonPrompt;
            }
            return jsonFormat;
        }
        return format as ScrapeFormat;
    });
}

// ============================================================================
// Scrape
// ============================================================================

interface FirecrawlScrapeResponse {
    success: boolean;
    data: {
        markdown?: string;
        html?: string;
        rawHtml?: string;
        links?: string[];
        screenshot?: string;
        images?: string[];
        json?: Record<string, unknown>;
        metadata: {
            title?: string;
            description?: string;
            language?: string;
            sourceURL: string;
            statusCode: number;
        };
        actions?: {
            screenshots?: string[];
            scrapes?: Array<{ url: string; html?: string }>;
        };
    };
}

/**
 * Scrapes a single URL and returns its content
 */
export async function webScrape(
    params: WebScrapeParams,
    timeoutMs?: number
): Promise<WebScrapeResult> {
    // Validate URL
    validateUrl(params.url, 'scrape');

    // Build request body
    const body: Record<string, unknown> = {
        url: params.url,
        formats: buildFormats(
            params.formats || ['markdown'],
            params.jsonSchema,
            params.jsonPrompt
        ),
    };

    if (params.actions && params.actions.length > 0) {
        body.actions = params.actions;
    }

    if (params.waitFor) {
        body.waitFor = params.waitFor;
    }

    if (params.onlyMainContent !== undefined) {
        body.onlyMainContent = params.onlyMainContent;
    }

    if (params.timeout) {
        body.timeout = params.timeout;
    }

    // Make request
    const effectiveTimeout = Math.min(
        timeoutMs || WEB_API_CONFIG.SCRAPE_TIMEOUT_MS,
        WEB_API_CONFIG.SCRAPE_TIMEOUT_MS
    );

    const response = await makeRequest<FirecrawlScrapeResponse>(
        '/v2/scrape',
        body,
        effectiveTimeout,
        'scrape'
    );

    // Transform response
    const data = response.data;
    return {
        markdown: truncateContent(data.markdown, WEB_API_CONFIG.MAX_MARKDOWN_LENGTH),
        html: truncateContent(data.html, WEB_API_CONFIG.MAX_MARKDOWN_LENGTH),
        links: data.links,
        screenshot: data.screenshot,
        json: data.json,
        title: data.metadata?.title,
        description: data.metadata?.description,
        sourceUrl: data.metadata?.sourceURL || params.url,
        statusCode: data.metadata?.statusCode || 200,
    };
}

// ============================================================================
// Crawl
// ============================================================================

interface FirecrawlCrawlStartResponse {
    success: boolean;
    id: string;
    url: string;
}

interface FirecrawlCrawlStatusResponse {
    success?: boolean;
    status: 'scraping' | 'completed' | 'failed' | 'cancelled';
    total: number;
    completed: number;
    creditsUsed: number;
    expiresAt?: string;
    next?: string;
    data: Array<{
        markdown?: string;
        html?: string;
        links?: string[];
        metadata: {
            title?: string;
            description?: string;
            sourceURL: string;
            statusCode: number;
        };
    }>;
}

/**
 * Crawls a website starting from the given URL
 */
export async function webCrawl(
    params: WebCrawlParams,
    timeoutMs?: number
): Promise<WebCrawlResult> {
    // Validate URL
    validateUrl(params.url, 'crawl');

    // Validate and clamp limits
    const limit = Math.min(
        Math.max(params.limit || WEB_API_CONFIG.DEFAULT_CRAWL_LIMIT, 1),
        WEB_API_CONFIG.MAX_CRAWL_LIMIT
    );

    const maxDepth = Math.min(
        Math.max(params.maxDepth || 3, 1),
        WEB_API_CONFIG.MAX_CRAWL_DEPTH
    );

    // Build request body
    const body: Record<string, unknown> = {
        url: params.url,
        limit,
        maxDepth,
        formats: params.formats || ['markdown'],
    };

    if (params.includePaths && params.includePaths.length > 0) {
        body.includePaths = params.includePaths;
    }

    if (params.excludePaths && params.excludePaths.length > 0) {
        body.excludePaths = params.excludePaths;
    }

    const effectiveTimeout = Math.min(
        timeoutMs || WEB_API_CONFIG.CRAWL_TIMEOUT_MS,
        WEB_API_CONFIG.CRAWL_TIMEOUT_MS
    );

    // Start the crawl
    const startResponse = await makeRequest<FirecrawlCrawlStartResponse>(
        '/v2/crawl',
        body,
        effectiveTimeout,
        'crawl'
    );

    // Poll for completion
    const crawlId = startResponse.id;
    const pollInterval = 2000; // 2 seconds
    const maxPollTime = effectiveTimeout - 5000; // Leave 5s buffer
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(
                `${WEB_API_CONFIG.BASE_URL}/v2/crawl/${crawlId}`,
                {
                    method: 'GET',
                    headers: buildHeaders(),
                    signal: controller.signal,
                }
            );

            const status = (await response.json()) as FirecrawlCrawlStatusResponse;

            if (status.status === 'completed' || status.status === 'failed') {
                // Transform response
                return {
                    status: status.status,
                    total: status.total,
                    completed: status.completed,
                    pages: status.data.map((page) => ({
                        markdown: truncateContent(
                            page.markdown,
                            WEB_API_CONFIG.MAX_MARKDOWN_LENGTH
                        ),
                        html: truncateContent(page.html, WEB_API_CONFIG.MAX_MARKDOWN_LENGTH),
                        links: page.links,
                        title: page.metadata?.title,
                        description: page.metadata?.description,
                        sourceUrl: page.metadata?.sourceURL,
                        statusCode: page.metadata?.statusCode || 200,
                    })),
                };
            }

            // Wait before polling again
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                // Continue polling
            } else {
                throw error;
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    // Timeout - return partial results
    throw new TimeoutError(effectiveTimeout);
}

// ============================================================================
// Map
// ============================================================================

interface FirecrawlMapResponse {
    success: boolean;
    links?: string[];
    urls?: string[];
}

/**
 * Maps a website to discover all URLs
 */
export async function webMap(
    params: WebMapParams,
    timeoutMs?: number
): Promise<WebMapResult> {
    // Validate URL
    validateUrl(params.url, 'map');

    // Validate and clamp limit
    const limit = Math.min(
        Math.max(params.limit || WEB_API_CONFIG.DEFAULT_MAP_LIMIT, 1),
        WEB_API_CONFIG.MAX_MAP_LIMIT
    );

    // Build request body
    const body: Record<string, unknown> = {
        url: params.url,
        limit,
    };

    if (params.search) {
        body.search = params.search;
    }

    if (params.includeSubdomains !== undefined) {
        body.includeSubdomains = params.includeSubdomains;
    }

    const effectiveTimeout = Math.min(
        timeoutMs || WEB_API_CONFIG.MAP_TIMEOUT_MS,
        WEB_API_CONFIG.MAP_TIMEOUT_MS
    );

    const response = await makeRequest<FirecrawlMapResponse>(
        '/v2/map',
        body,
        effectiveTimeout,
        'map'
    );

    // Handle both 'links' and 'urls' response formats
    const urls = response.links || response.urls || [];

    return {
        urls,
        total: urls.length,
    };
}

// ============================================================================
// Search
// ============================================================================

interface FirecrawlSearchResponse {
    success: boolean;
    data: {
        web?: Array<{
            url: string;
            title: string;
            description?: string;
            position: number;
            markdown?: string;
        }>;
        images?: Array<{
            title: string;
            imageUrl: string;
            url: string;
            position: number;
        }>;
        news?: Array<{
            title: string;
            url: string;
            snippet?: string;
            date?: string;
            position: number;
        }>;
    };
}

/**
 * Searches the web and optionally scrapes results
 */
export async function webSearch(
    params: WebSearchParams,
    timeoutMs?: number
): Promise<WebSearchResult> {
    // Validate query
    if (!params.query || typeof params.query !== 'string') {
        throw new ValidationError('Search query is required');
    }

    // Validate and clamp limit
    const limit = Math.min(
        Math.max(params.limit || WEB_API_CONFIG.DEFAULT_SEARCH_LIMIT, 1),
        WEB_API_CONFIG.MAX_SEARCH_LIMIT
    );

    // Build request body
    const body: Record<string, unknown> = {
        query: params.query,
        limit,
    };

    if (params.country) {
        body.country = params.country;
    }

    if (params.language) {
        body.lang = params.language;
    }

    if (params.scrapeResults) {
        body.scrapeOptions = {
            formats: ['markdown'],
        };
    }

    const effectiveTimeout = Math.min(
        timeoutMs || WEB_API_CONFIG.SEARCH_TIMEOUT_MS,
        WEB_API_CONFIG.SEARCH_TIMEOUT_MS
    );

    const response = await makeRequest<FirecrawlSearchResponse>(
        '/v2/search',
        body,
        effectiveTimeout,
        'search'
    );

    // Transform response
    const webResults = response.data?.web || [];

    return {
        results: webResults.map((result) => ({
            url: result.url,
            title: result.title,
            description: result.description,
            markdown: truncateContent(
                result.markdown,
                WEB_API_CONFIG.MAX_MARKDOWN_LENGTH
            ),
        })),
        total: webResults.length,
    };
}
