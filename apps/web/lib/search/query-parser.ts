/**
 * Lucene-like query parser for advanced search.
 *
 * Supports:
 * - Boolean operators: AND, OR, NOT (and &&, ||, -)
 * - Grouping with parentheses: (a OR b) AND c
 * - Phrase search: "exact phrase"
 * - Field-specific search: title:hello content:"my phrase"
 * - Negation: -term NOT term
 * - Implicit AND between terms (configurable)
 *
 * Example queries:
 * - hello world                        -> hello AND world (implicit)
 * - "hello world"                      -> exact phrase match
 * - hello OR world                     -> either hello or world
 * - hello AND world                    -> both terms required
 * - hello -world                       -> hello but not world
 * - (hello OR hi) AND world            -> grouped boolean
 * - title:"project name" content:code  -> field-specific search
 */

export type QueryNodeType = 'term' | 'phrase' | 'and' | 'or' | 'not' | 'field';

export interface TermNode {
  type: 'term';
  value: string;
}

export interface PhraseNode {
  type: 'phrase';
  value: string;
}

export interface AndNode {
  type: 'and';
  children: QueryNode[];
}

export interface OrNode {
  type: 'or';
  children: QueryNode[];
}

export interface NotNode {
  type: 'not';
  child: QueryNode;
}

export interface FieldNode {
  type: 'field';
  field: string;
  child: QueryNode;
}

export type QueryNode =
  | TermNode
  | PhraseNode
  | AndNode
  | OrNode
  | NotNode
  | FieldNode;

export interface ParsedAdvancedQuery {
  ast: QueryNode | null;
  /** Multi-token phrases that require post-filtering */
  phrases: string[];
  hasComplexBooleans: boolean;
  originalQuery: string;
}

/**
 * Tokenizer function type - used to check if a phrase is single-token
 */
export type TokenizerFn = (text: string) => string[];

// Token types for lexer
type TokenType =
  | 'TERM'
  | 'PHRASE'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'LPAREN'
  | 'RPAREN'
  | 'COLON'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

/**
 * Lexer: Tokenizes the query string
 */
class QueryLexer {
  private input: string;
  private position: number = 0;
  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.position = 0;

    while (this.position < this.input.length) {
      this.skipWhitespace();
      if (this.position >= this.input.length) break;

      const char = this.input[this.position];

      // Handle quoted strings (phrases)
      if (char === '"' || char === "'") {
        this.readPhrase(char);
        continue;
      }

      // Handle parentheses
      if (char === '(') {
        this.tokens.push({
          type: 'LPAREN',
          value: '(',
          position: this.position,
        });
        this.position++;
        continue;
      }

      if (char === ')') {
        this.tokens.push({
          type: 'RPAREN',
          value: ')',
          position: this.position,
        });
        this.position++;
        continue;
      }

      // Handle colon (for field queries)
      if (char === ':') {
        this.tokens.push({
          type: 'COLON',
          value: ':',
          position: this.position,
        });
        this.position++;
        continue;
      }

      // Handle NOT prefix (-)
      if (char === '-' && this.peekNextNonWhitespace() !== ' ') {
        this.tokens.push({ type: 'NOT', value: '-', position: this.position });
        this.position++;
        continue;
      }

      // Handle && and ||
      if (char === '&' && this.peek(1) === '&') {
        this.tokens.push({ type: 'AND', value: '&&', position: this.position });
        this.position += 2;
        continue;
      }

      if (char === '|' && this.peek(1) === '|') {
        this.tokens.push({ type: 'OR', value: '||', position: this.position });
        this.position += 2;
        continue;
      }

      // Read a word (term or keyword)
      this.readWord();
    }

    this.tokens.push({ type: 'EOF', value: '', position: this.position });
    return this.tokens;
  }

  private skipWhitespace(): void {
    while (
      this.position < this.input.length &&
      /\s/.test(this.input[this.position])
    ) {
      this.position++;
    }
  }

  private peek(offset: number = 0): string | undefined {
    return this.input[this.position + offset];
  }

  private peekNextNonWhitespace(): string | undefined {
    let pos = this.position + 1;
    while (pos < this.input.length && /\s/.test(this.input[pos])) {
      pos++;
    }
    return this.input[pos];
  }

  private readPhrase(quoteChar: string): void {
    const startPos = this.position;
    this.position++; // Skip opening quote

    let value = '';
    while (
      this.position < this.input.length &&
      this.input[this.position] !== quoteChar
    ) {
      // Handle escaped quotes
      if (this.input[this.position] === '\\' && this.peek(1) === quoteChar) {
        value += quoteChar;
        this.position += 2;
      } else {
        value += this.input[this.position];
        this.position++;
      }
    }

    if (this.position < this.input.length) {
      this.position++; // Skip closing quote
    }

    if (value.trim()) {
      this.tokens.push({
        type: 'PHRASE',
        value: value.trim(),
        position: startPos,
      });
    }
  }

  private readWord(): void {
    const startPos = this.position;
    let value = '';

    while (
      this.position < this.input.length &&
      !this.isSpecialChar(this.input[this.position])
    ) {
      value += this.input[this.position];
      this.position++;
    }

    if (!value) return;

    const upperValue = value.toUpperCase();

    // Check for keywords
    if (upperValue === 'AND') {
      this.tokens.push({ type: 'AND', value, position: startPos });
    } else if (upperValue === 'OR') {
      this.tokens.push({ type: 'OR', value, position: startPos });
    } else if (upperValue === 'NOT') {
      this.tokens.push({ type: 'NOT', value, position: startPos });
    } else {
      this.tokens.push({ type: 'TERM', value, position: startPos });
    }
  }

  private isSpecialChar(char: string): boolean {
    return /[\s"'():&|]/.test(char);
  }
}

/**
 * Parser: Builds AST from tokens
 *
 * Grammar (simplified):
 * query      -> orExpr
 * orExpr     -> andExpr (OR andExpr)*
 * andExpr    -> notExpr ((AND)? notExpr)*
 * notExpr    -> NOT? primary
 * primary    -> LPAREN query RPAREN | fieldExpr | term | phrase
 * fieldExpr  -> TERM COLON (term | phrase | LPAREN query RPAREN)
 */
class QueryParser {
  private tokens: Token[] = [];
  private position: number = 0;
  private phrases: string[] = [];

  parse(tokens: Token[]): { ast: QueryNode | null; phrases: string[] } {
    this.tokens = tokens;
    this.position = 0;
    this.phrases = [];

    if (this.isAtEnd()) {
      return { ast: null, phrases: [] };
    }

    const ast = this.parseOrExpr();
    return { ast, phrases: this.phrases };
  }

  private parseOrExpr(): QueryNode | null {
    let left = this.parseAndExpr();
    if (!left) return null;

    const children: QueryNode[] = [left];

    while (this.check('OR')) {
      this.advance(); // consume OR
      const right = this.parseAndExpr();
      if (right) {
        children.push(right);
      }
    }

    if (children.length === 1) {
      return children[0];
    }

    return { type: 'or', children };
  }

  private parseAndExpr(): QueryNode | null {
    let left = this.parseNotExpr();
    if (!left) return null;

    const children: QueryNode[] = [left];

    while (!this.isAtEnd() && !this.check('OR') && !this.check('RPAREN')) {
      // Optional AND keyword (implicit AND)
      if (this.check('AND')) {
        this.advance();
      }

      const right = this.parseNotExpr();
      if (right) {
        children.push(right);
      } else {
        break;
      }
    }

    if (children.length === 1) {
      return children[0];
    }

    return { type: 'and', children };
  }

  private parseNotExpr(): QueryNode | null {
    if (this.check('NOT')) {
      this.advance();
      const child = this.parsePrimary();
      if (!child) return null;
      return { type: 'not', child };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode | null {
    // Grouped expression
    if (this.check('LPAREN')) {
      this.advance(); // consume (
      const expr = this.parseOrExpr();
      if (this.check('RPAREN')) {
        this.advance(); // consume )
      }
      return expr;
    }

    // Phrase
    if (this.check('PHRASE')) {
      const token = this.advance();
      this.phrases.push(token.value);
      return { type: 'phrase', value: token.value };
    }

    // Term (possibly with field prefix)
    if (this.check('TERM')) {
      const termToken = this.advance();

      // Check for field:value pattern
      if (this.check('COLON')) {
        this.advance(); // consume :
        const field = termToken.value;

        // Field with phrase value
        if (this.check('PHRASE')) {
          const phraseToken = this.advance();
          this.phrases.push(phraseToken.value);
          return {
            type: 'field',
            field,
            child: { type: 'phrase', value: phraseToken.value },
          };
        }

        // Field with grouped query
        if (this.check('LPAREN')) {
          this.advance();
          const subQuery = this.parseOrExpr();
          if (this.check('RPAREN')) {
            this.advance();
          }
          if (subQuery) {
            return { type: 'field', field, child: subQuery };
          }
        }

        // Field with simple term
        if (this.check('TERM')) {
          const valueToken = this.advance();
          return {
            type: 'field',
            field,
            child: { type: 'term', value: valueToken.value },
          };
        }

        // Field with no value, treat as regular term
        return { type: 'term', value: termToken.value };
      }

      return { type: 'term', value: termToken.value };
    }

    return null;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.tokens[this.position].type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.position++;
    }
    return this.tokens[this.position - 1];
  }

  private isAtEnd(): boolean {
    return (
      this.position >= this.tokens.length ||
      this.tokens[this.position].type === 'EOF'
    );
  }
}

/**
 * Check if the AST contains complex boolean operations (OR, NOT, nested AND)
 */
function hasComplexBooleans(node: QueryNode | null): boolean {
  if (!node) return false;

  switch (node.type) {
    case 'or':
      return true;
    case 'not':
      return true;
    case 'and':
      // Check if any child is complex
      return node.children.some(hasComplexBooleans);
    case 'field':
      return hasComplexBooleans(node.child);
    default:
      return false;
  }
}

/**
 * Extract all terms from the AST (for simple fallback search)
 */
export function extractTerms(node: QueryNode | null): string[] {
  if (!node) return [];

  switch (node.type) {
    case 'term':
      return [node.value];
    case 'phrase':
      return [node.value];
    case 'and':
    case 'or':
      return node.children.flatMap(extractTerms);
    case 'not':
      return []; // Don't include negated terms in simple search
    case 'field':
      return extractTerms(node.child);
  }
}

/**
 * Extract all phrases from the AST
 */
export function extractPhrases(node: QueryNode | null): string[] {
  if (!node) return [];

  switch (node.type) {
    case 'phrase':
      return [node.value];
    case 'term':
      return [];
    case 'and':
    case 'or':
      return node.children.flatMap(extractPhrases);
    case 'not':
      return extractPhrases(node.child);
    case 'field':
      return extractPhrases(node.child);
  }
}

/**
 * Convert AST back to a simple query string (for simple searches)
 */
export function toSimpleQuery(node: QueryNode | null): string {
  if (!node) return '';

  switch (node.type) {
    case 'term':
      return node.value;
    case 'phrase':
      return node.value; // Return without quotes for FlexSearch
    case 'and':
      return node.children.map(toSimpleQuery).filter(Boolean).join(' ');
    case 'or':
      // For simple search, join all terms
      return node.children.map(toSimpleQuery).filter(Boolean).join(' ');
    case 'not':
      return ''; // Exclude negated terms from simple query
    case 'field':
      return toSimpleQuery(node.child);
  }
}

/**
 * Parse a Lucene-like query string into an AST
 * @param query The query string to parse
 * @param tokenizer Optional tokenizer function to detect single-token phrases
 */
export function parseAdvancedQuery(
  query: string,
  tokenizer?: TokenizerFn
): ParsedAdvancedQuery {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return {
      ast: null,
      phrases: [],
      hasComplexBooleans: false,
      originalQuery: query,
    };
  }

  const lexer = new QueryLexer(trimmedQuery);
  const tokens = lexer.tokenize();

  const parser = new QueryParser();
  const { ast, phrases: rawPhrases } = parser.parse(tokens);

  // Filter out single-token phrases (they don't need phrase matching)
  // A phrase is single-token if the tokenizer returns only one token
  const phrases = tokenizer
    ? rawPhrases.filter((phrase) => {
        const tokens = tokenizer(phrase);
        return tokens.length > 1;
      })
    : rawPhrases;

  // If we have a tokenizer, convert single-token phrases to regular terms in the AST
  const processedAst = tokenizer
    ? convertSingleTokenPhrases(ast, tokenizer)
    : ast;

  return {
    ast: processedAst,
    phrases,
    hasComplexBooleans: hasComplexBooleans(processedAst),
    originalQuery: query,
  };
}

/**
 * Convert single-token phrases to regular terms in the AST
 */
function convertSingleTokenPhrases(
  node: QueryNode | null,
  tokenizer: TokenizerFn
): QueryNode | null {
  if (!node) return null;

  switch (node.type) {
    case 'phrase': {
      const tokens = tokenizer(node.value);
      // If single token, convert to term
      if (tokens.length <= 1) {
        return { type: 'term', value: node.value };
      }
      return node;
    }
    case 'term':
      return node;
    case 'and':
      return {
        type: 'and',
        children: node.children
          .map((child) => convertSingleTokenPhrases(child, tokenizer))
          .filter((child): child is QueryNode => child !== null),
      };
    case 'or':
      return {
        type: 'or',
        children: node.children
          .map((child) => convertSingleTokenPhrases(child, tokenizer))
          .filter((child): child is QueryNode => child !== null),
      };
    case 'not': {
      const processedChild = convertSingleTokenPhrases(node.child, tokenizer);
      if (!processedChild) return null;
      return { type: 'not', child: processedChild };
    }
    case 'field': {
      const processedChild = convertSingleTokenPhrases(node.child, tokenizer);
      if (!processedChild) return null;
      return { type: 'field', field: node.field, child: processedChild };
    }
  }
}

/**
 * Check if text contains an exact phrase (case-insensitive)
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedPhrase = phrase.toLowerCase();
  return normalizedText.includes(normalizedPhrase);
}

/**
 * Check if text matches all phrases
 */
export function matchesAllPhrases(text: string, phrases: string[]): boolean {
  if (phrases.length === 0) return true;
  return phrases.every((phrase) => containsPhrase(text, phrase));
}
