const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const RCDATA_ELEMENTS = new Set(['textarea', 'title']);

const RAW_CONTENT_ELEMENTS = new Set([
    ...RAW_TEXT_ELEMENTS,
    ...RCDATA_ELEMENTS,
]);

function isWhitespace(char) {
    return (
        char === ' ' ||
        char === '\t' ||
        char === '\n' ||
        char === '\f' ||
        char === '\r'
    );
}

function isLetter(char) {
    if (!char) return false;
    const code = char.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isValidTagChar(char) {
    if (!char) return false;
    return !isWhitespace(char) && char !== '>' && char !== '/';
}

/**
 * Safely sets attribute on dictionary without prototype pollution
 * and respects first-attribute-wins rule.
 */
function setAttribute(attributes, name, value) {
    if (Object.prototype.hasOwnProperty.call(attributes, name)) {
        return;
    }
    attributes[name] = value;
}

/**
 * Helper to read text until a specific marker tag/substring is found.
 */
function readUntil(html, start, marker) {
    const index = html.indexOf(marker, start);
    if (index === -1) {
        return {
            content: html.slice(start),
            nextIndex: html.length,
            found: false,
        };
    }
    return {
        content: html.slice(start, index),
        nextIndex: index + marker.length,
        found: true,
    };
}

/**
 * Helper to find the index of the matching closing tag for RAW TEXT / RCDATA elements.
 */
function findClosingTagIndex(html, lowerTagName, startIndex) {
    const tagLen = lowerTagName.length;
    let searchPos = startIndex;

    while (searchPos < html.length) {
        const closeStart = html.indexOf('</', searchPos);
        if (closeStart === -1) {
            return -1;
        }

        const candidateName = html
            .slice(closeStart + 2, closeStart + 2 + tagLen)
            .toLowerCase();

        if (candidateName === lowerTagName) {
            const nextChar = html[closeStart + 2 + tagLen];

            if (
                nextChar === undefined ||
                nextChar === '>' ||
                nextChar === '/' ||
                isWhitespace(nextChar)
            ) {
                return closeStart;
            }
        }

        searchPos = closeStart + 2;
    }

    return -1;
}

/**
 * Parses tag attributes into a key-value dictionary and identifies self-closing state.
 */
function readAttributes(html, startIndex) {
    const attributes = Object.create(null);
    let i = startIndex;

    while (i < html.length) {
        while (i < html.length && isWhitespace(html[i])) {
            i++;
        }

        if (i >= html.length) {
            return { attributes, end: -1, selfClosing: false };
        }

        if (html[i] === '>') {
            return { attributes, end: i, selfClosing: false };
        }

        if (html[i] === '/' && html[i + 1] === '>') {
            return { attributes, end: i + 1, selfClosing: true };
        }

        // Protection against lone '/' not followed by '>'
        if (html[i] === '/') {
            i++;
            continue;
        }

        const attrNameStart = i;
        while (
            i < html.length &&
            !isWhitespace(html[i]) &&
            html[i] !== '=' &&
            html[i] !== '>' &&
            html[i] !== '/'
        ) {
            i++;
        }

        // Infinite loop protection if attribute name is empty
        if (i === attrNameStart) {
            i++;
            continue;
        }

        const attrName = html.slice(attrNameStart, i).toLowerCase();

        while (i < html.length && isWhitespace(html[i])) {
            i++;
        }

        if (html[i] === '=') {
            i++;

            while (i < html.length && isWhitespace(html[i])) {
                i++;
            }

            let attrValue = '';

            if (html[i] === '"' || html[i] === "'") {
                const quote = html[i];
                i++;
                const valStart = i;

                while (i < html.length && html[i] !== quote) {
                    i++;
                }

                attrValue = html.slice(valStart, i);

                if (i < html.length) {
                    i++;
                }
            } else {
                const valStart = i;

                while (
                    i < html.length &&
                    !isWhitespace(html[i]) &&
                    html[i] !== '>'
                ) {
                    i++;
                }

                attrValue = html.slice(valStart, i);
            }

            setAttribute(attributes, attrName, attrValue);
        } else {
            setAttribute(attributes, attrName, '');
        }
    }

    return { attributes, end: -1, selfClosing: false };
}

/**
 * Tokenizes raw HTML string into structured tokens.
 */
function tokenize(html) {
    const tokens = [];
    let i = 0;

    while (i < html.length) {
        const nextTag = html.indexOf('<', i);

        if (nextTag === -1) {
            tokens.push({ type: 'text', content: html.slice(i) });
            break;
        }

        // 1. Collect text before '<'
        if (nextTag > i) {
            tokens.push({ type: 'text', content: html.slice(i, nextTag) });
            i = nextTag;
        }

        // 2. Comments <!-- ... -->
        if (html.startsWith('<!--', i)) {
            const { content, nextIndex, found } = readUntil(html, i + 4, '-->');
            tokens.push({ type: 'comment', content });
            if (!found) break;
            i = nextIndex;
            continue;
        }

        // 3. DOCTYPE declaration <!doctype ...>
        if (
            html.startsWith('<!', i) &&
            html.slice(i + 2, i + 9).toLowerCase() === 'doctype'
        ) {
            const { content, nextIndex, found } = readUntil(html, i + 9, '>');
            tokens.push({ type: 'doctype', content: content.trim() });
            if (!found) break;
            i = nextIndex;
            continue;
        }

        // 4. Bogus comments <!...> and <?...>
        if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
            const { content, nextIndex, found } = readUntil(html, i + 2, '>');
            tokens.push({ type: 'comment', content });
            if (!found) break;
            i = nextIndex;
            continue;
        }

        // 5. Validate if it's a real start or end tag
        const charAfterLt = html[i + 1];
        const isEndTag = charAfterLt === '/' && isLetter(html[i + 2]);
        const isStartTag = isLetter(charAfterLt);

        if (!isStartTag && !isEndTag) {
            tokens.push({ type: 'text', content: '<' });
            i++;
            continue;
        }

        // 6. Read tag name
        const nameStart = isEndTag ? i + 2 : i + 1;
        let nameEnd = nameStart;

        while (nameEnd < html.length && isValidTagChar(html[nameEnd])) {
            nameEnd++;
        }

        const tagName = html.slice(nameStart, nameEnd).toLowerCase();

        // 7. Read attributes and ending bracket '>'
        const { attributes, end, selfClosing } = readAttributes(html, nameEnd);

        if (end === -1) {
            tokens.push({ type: 'text', content: html.slice(i) });
            break;
        }

        if (isEndTag) {
            tokens.push({ type: 'endTag', tag: tagName });
        } else {
            tokens.push({
                type: 'startTag',
                tag: tagName,
                attributes,
                selfClosing,
            });
        }

        i = end + 1;

        // 8. Handle RAW TEXT and RCDATA elements (script, style, textarea, title)
        if (!isEndTag && RAW_CONTENT_ELEMENTS.has(tagName) && !selfClosing) {
            const closeTagIndex = findClosingTagIndex(html, tagName, i);

            if (closeTagIndex !== -1) {
                const rawTextContent = html.slice(i, closeTagIndex);
                if (rawTextContent.length > 0) {
                    tokens.push({ type: 'text', content: rawTextContent });
                }
                i = closeTagIndex;
            } else {
                const remainingText = html.slice(i);
                if (remainingText.length > 0) {
                    tokens.push({ type: 'text', content: remainingText });
                }
                break;
            }
        }
    }

    return tokens;
}

/**
 * Builds an AST / JSON tree from token list.
 */
function buildTree(tokens) {
    const root = { type: 'root', children: [] };
    const stack = [root];

    for (const token of tokens) {
        const parent = stack[stack.length - 1];

        if (token.type === 'text') {
            const lastChild = parent.children[parent.children.length - 1];
            if (lastChild && lastChild.type === 'text') {
                lastChild.content += token.content;
            } else {
                parent.children.push({ type: 'text', content: token.content });
            }
        } else if (token.type === 'comment' || token.type === 'doctype') {
            parent.children.push({ type: token.type, content: token.content });
        } else if (token.type === 'startTag') {
            const element = {
                type: 'element',
                tag: token.tag,
                attributes: token.attributes,
                children: [],
            };

            parent.children.push(element);

            const isVoid = VOID_ELEMENTS.has(token.tag);
            if (!isVoid && !token.selfClosing) {
                stack.push(element);
            }
        } else if (token.type === 'endTag') {
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tag === token.tag) {
                    stack.length = i;
                    break;
                }
            }
        }
    }

    return root;
}
