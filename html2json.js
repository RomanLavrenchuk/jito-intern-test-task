function convertHtml2JsonAndSet() {
    const htmlTextAreaValue = document.getElementById('html').value;
    const jsonObj = html2json(htmlTextAreaValue);
    const jsonArea = document.getElementById('json');
    jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
}

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

const NAMED_ENTITIES = Object.assign(Object.create(null), {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00A0',
    copy: '©',
    reg: '®',
    trade: '™',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
});

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
const RCDATA_ELEMENTS = new Set(['textarea', 'title']);

const RAW_CONTENT_ELEMENTS = new Set([
    ...RAW_TEXT_ELEMENTS,
    ...RCDATA_ELEMENTS,
]);

function safeFromCodePoint(codePoint, fallback) {
    if (isNaN(codePoint)) return fallback;

    // Перевірка меж Unicode та сурогатних пар UTF-16 (0xD800–0xDFFF)
    if (
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
        return '\uFFFD'; // Символ заміни
    }

    try {
        return String.fromCodePoint(codePoint);
    } catch {
        return '\uFFFD';
    }
}

function decodeEntities(str) {
    if (!str || typeof str !== 'string' || !str.includes('&')) {
        return str;
    }

    return str.replace(
        /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
        (match, body) => {
            // 1. Шістнадцяткові: &#xA9; або &#XA9;
            if (body.startsWith('#x') || body.startsWith('#X')) {
                const codePoint = parseInt(body.slice(2), 16);
                return safeFromCodePoint(codePoint, match);
            }

            // 2. Десяткові: &#169;
            if (body.startsWith('#')) {
                const codePoint = parseInt(body.slice(1), 10);
                return safeFromCodePoint(codePoint, match);
            }

            // 3. Іменовані: &copy;
            if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)) {
                return NAMED_ENTITIES[body];
            }

            return match;
        },
    );
}

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

            setAttribute(attributes, attrName, decodeEntities(attrValue));
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
            tokens.push({
                type: 'text',
                content: decodeEntities(html.slice(i)),
            });
            break;
        }

        // 1. Collect text before '<'
        if (nextTag > i) {
            tokens.push({
                type: 'text',
                content: decodeEntities(html.slice(i, nextTag)),
            });
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
                let rawTextContent = html.slice(i, closeTagIndex);

                // RCDATA (textarea, title) декодує сутності, a script/style ні
                if (RCDATA_ELEMENTS.has(tagName)) {
                    rawTextContent = decodeEntities(rawTextContent);
                }

                if (rawTextContent.length > 0) {
                    tokens.push({ type: 'text', content: rawTextContent });
                }
                i = closeTagIndex;
            } else {
                let remainingText = html.slice(i);

                // для випадку, коли закриваючий тег відсутній до кінця файлу
                if (RCDATA_ELEMENTS.has(tagName)) {
                    remainingText = decodeEntities(remainingText);
                }
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
function html2json(htmlText) {
    return buildTree(tokenize(htmlText));
}

function showExample1() {
    const htmlExample = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
    </header>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the webpage.</p>
        </section>
        <section id="about">
            <h2>About Section</h2>
            <p>This is the about section of the webpage.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 My Website</p>
    </footer>
    <script src="script.js"></script>
</body>
</html>
`;
    const jsonContent = {
        'Comment 1':
            'You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.',
        'Comment 2':
            'When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.',
    };

    document.getElementById('html').value = htmlExample;
    document.getElementById('json').textContent = JSON.stringify(
        jsonContent,
        null,
        2,
    );
}

function showExample2() {
    const htmlExample = `<div>
<p>Hello world!</p>
  <button>Click me!</button>
  <textarea>Some very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very long string.</textarea>
</div>
`;
    const jsonContent = {
        'Comment 1':
            'You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.',
        'Comment 2':
            'When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.',
    };

    document.getElementById('html').value = htmlExample;
    document.getElementById('json').textContent = JSON.stringify(
        jsonContent,
        null,
        2,
    );
}
