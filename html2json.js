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
    'source',
    'track',
    'wbr',
]);

// Helper: Only letters are valid for the FIRST character of a tag name
function isLetter(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

// Helper: Letters, numbers, and hyphens are valid for subsequent characters
function isValidTagChar(ch) {
    return isLetter(ch) || (ch >= '0' && ch <= '9') || ch === '-';
}

function buildTree(tokens) {
    const root = { type: 'root', children: [] };
    const stack = [root];

    for (const token of tokens) {
        const currentParent = stack[stack.length - 1];

        if (token.type === 'text') {
            const lastChild =
                currentParent.children[currentParent.children.length - 1];

            // Якщо попередній дочірній елемент — це вже текст, об'єднуємо їх
            if (lastChild && lastChild.type === 'text') {
                lastChild.content += token.content;
            } else {
                currentParent.children.push({
                    type: 'text',
                    content: token.content,
                });
            }
        } else if (token.type === 'doctype') {
            // Додаємо doctype до дітей поточного батька
            currentParent.children.push({
                type: 'doctype',
                content: token.content,
            });
        } else if (token.type === 'comment') {
            //Додаємо вузол коментаря до дітей поточного батька
            currentParent.children.push({
                type: 'comment',
                content: token.content,
            });
        } else if (token.type === 'startTag') {
            const newNode = {
                type: 'element',
                tag: token.tag,
                attributes: token.attributes, // Використовуємо зчитані атрибути
                children: [],
            };
            currentParent.children.push(newNode);
            // Не кладемо у стек, якщо елемент void АБО самозакриваючий (selfClosing)
            const isVoid = VOID_ELEMENTS.has(token.tag);
            if (!isVoid && !token.selfClosing) {
                stack.push(newNode);
            }
        } else if (token.type === 'endTag') {
            if (stack.length > 1 && currentParent.tag === token.tag) {
                stack.pop();
            }
        }
    }

    return root;
}

// Перевірка на пробілові символи (Space, Tab, Newline, Carriage Return, Form Feed)
function isWhitespace(ch) {
    return (
        ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
    );
}

// Помічник для безпечного встановлення атрибутів (зберігається тільки перше значення)
function setAttribute(attributes, name, value) {
    if (!(name in attributes)) {
        attributes[name] = value;
    }
}
function readAttributes(html, start) {
    const attributes = Object.create(null);
    let i = start;
    let selfClosing = false;

    while (i < html.length) {
        const ch = html[i];

        // 1. Пропускаємо пробіли
        if (isWhitespace(ch)) {
            i++;
            continue;
        }

        // 2. Кінець тегу '>'
        if (ch === '>') {
            return { attributes, end: i, selfClosing: false };
        }

        // Обробка '/'
        if (ch === '/') {
            if (i + 1 < html.length && html[i + 1] === '>') {
                selfClosing = true;
                return { attributes, end: i + 1, selfClosing: true };
            }
            i++;
            continue;
        }

        // 4. Зчитуємо назву атрибута до пробілу, '=', '>' або '/'
        const nameStart = i;
        while (
            i < html.length &&
            !isWhitespace(html[i]) &&
            html[i] !== '=' &&
            html[i] !== '>' &&
            html[i] !== '/'
        ) {
            i++;
        }

        // Якщо це був некоректний символ (наприклад '=', який йде одразу без назви)
        if (i === nameStart) {
            i++;
            continue;
        }

        const attrName = html.slice(nameStart, i).toLowerCase();

        // 5. Пропускаємо пробіли перед '='
        while (i < html.length && isWhitespace(html[i])) {
            i++;
        }

        // Якщо після назви немає знака '=', це булевий атрибут (наприклад, disabled)
        if (i >= html.length || html[i] !== '=') {
            setAttribute(attributes, attrName, '');
            continue;
        }

        // Пропускаємо знак '='
        i++;

        // Пропускаємо пробіли після '='
        while (i < html.length && isWhitespace(html[i])) {
            i++;
        }

        if (i >= html.length) {
            setAttribute(attributes, attrName, '');
            break;
        }

        const valueStartChar = html[i];

        // Case A: Значення у подвійних або поодиноких лапках
        if (valueStartChar === '"' || valueStartChar === "'") {
            const quote = valueStartChar;
            const closeQuote = html.indexOf(quote, i + 1);

            if (closeQuote === -1) {
                // Незакрита лапка: вважаємо весь тег некоректним
                return { attributes, end: -1, selfClosing: false };
            }

            setAttribute(attributes, attrName, html.slice(i + 1, closeQuote));
            i = closeQuote + 1;
        }
        // Case B: Порожнє значення перед закриваючим тегом (наприклад, <div class=>)
        else if (valueStartChar === '>') {
            setAttribute(attributes, attrName, '');
            // Не робимо i++, щоб наступна ітерація побачила '>' і завершила цикл
        }
        // Case C: Значення без лапок (unquoted value)
        else {
            const valStart = i;
            while (
                i < html.length &&
                !isWhitespace(html[i]) &&
                html[i] !== '>'
            ) {
                i++;
            }
            setAttribute(attributes, attrName, html.slice(valStart, i));
        }
    }

    return { attributes, end: -1, selfClosing: false }; // Завершення рядка без закриваючого '>'
}

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

        // 2.Перевірка на коментар <!--
        if (html.startsWith('<!--', i)) {
            const closeComment = html.indexOf('-->', i + 4);

            if (closeComment !== -1) {
                // Знайшли закриваючий '-->'
                tokens.push({
                    type: 'comment',
                    content: html.slice(i + 4, closeComment),
                });
                i = closeComment + 3;
            } else {
                // Незакритий коментар: зчитуємо все до кінця документа
                tokens.push({
                    type: 'comment',
                    content: html.slice(i + 4),
                });
                break;
            }
            continue;
        }
        // 3. [НОВЕ] DOCTYPE: <!doctype ...> (case-insensitive)
        if (
            html.startsWith('<!', i) &&
            html.slice(i + 2, i + 9).toLowerCase() === 'doctype'
        ) {
            const closeGt = html.indexOf('>', i + 9);

            if (closeGt !== -1) {
                tokens.push({
                    type: 'doctype',
                    content: html.slice(i + 9, closeGt).trim(),
                });
                i = closeGt + 1;
            } else {
                tokens.push({
                    type: 'doctype',
                    content: html.slice(i + 9).trim(),
                });
                break;
            }
            continue;
        }

        // 4. [НОВЕ] Інші <!...> та <?...>: Bogus Comments (наприклад <![CDATA[x]]> або <?xml...>)
        if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
            const closeGt = html.indexOf('>', i + 2);

            if (closeGt !== -1) {
                tokens.push({
                    type: 'comment',
                    content: html.slice(i + 2, closeGt),
                });
                i = closeGt + 1;
            } else {
                tokens.push({
                    type: 'comment',
                    content: html.slice(i + 2),
                });
                break;
            }
            continue;
        }
        // 5. Перевіряємо, чи це реальний відкриваючий/закриваючий тег
        const charAfterLt = html[i + 1];
        const isEndTag = charAfterLt === '/' && isLetter(html[i + 2]);
        // Start tag must start with < followed by a letter (e.g., <a)
        const isStartTag = isLetter(charAfterLt);

        if (!isStartTag && !isEndTag) {
            // Not a real tag (e.g., "x <5 y" or "a <- b"), treat '<' as plain text
            tokens.push({ type: 'text', content: '<' });
            i++;
            continue;
        }

        // 3. Зчитуємо назву тегу
        const nameStart = isEndTag ? i + 2 : i + 1;
        let nameEnd = nameStart;

        while (nameEnd < html.length && isValidTagChar(html[nameEnd])) {
            nameEnd++;
        }
        const tagName = html.slice(nameStart, nameEnd).toLowerCase();

        // Викликаємо readAttributes для УСІХ тегів (у тому числі закриваючих)
        const { attributes, end, selfClosing } = readAttributes(html, nameEnd);

        if (end === -1) {
            tokens.push({ type: 'text', content: html.slice(i) });
            break;
        }
        if (isEndTag) {
            tokens.push({
                type: 'endTag',
                tag: tagName,
            });
        } else {
            tokens.push({
                type: 'startTag',
                tag: tagName,
                attributes,
                //Передаємо selfClosing у токен відкриваючого тегу
                selfClosing,
            });
        }

        i = end + 1;
    }

    return tokens;
}

/* 
  Update this function to convert html into json object.
  You can rewrite it completely, just be sure it accepts htmlText as string and outputs json object.
*/
function html2json(htmlText) {
    const tokens = tokenize(htmlText);
    return buildTree(tokens);
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
