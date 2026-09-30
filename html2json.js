function convertHtml2JsonAndSet() {
    const htmlTextAreaValue = document.getElementById('html').value;
    const jsonObj = html2json(htmlTextAreaValue);
    const jsonArea = document.getElementById('json');
    jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
}

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
        } else if (token.type === 'startTag') {
            const newNode = {
                type: 'element',
                tag: token.tag,
                attributes: {},
                children: [],
            };
            currentParent.children.push(newNode);
            stack.push(newNode); // Входимо у вкладений контекст елемента
        } else if (token.type === 'endTag') {
            // Порівнюємо безпосередньо з currentParent.tag для кращої читабельності
            if (stack.length > 1 && currentParent.tag === token.tag) {
                stack.pop();
            }
        }
    }

    return root;
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

        // 2. Look ahead past '<' to verify if it's a valid tag start
        const charAfterLt = html[i + 1];

        // End tag must start with </ followed by a letter (e.g., </a)
        const isEndTag = charAfterLt === '/' && isLetter(html[i + 2]);
        // Start tag must start with < followed by a letter (e.g., <a)
        const isStartTag = isLetter(charAfterLt);

        if (!isStartTag && !isEndTag) {
            // Not a real tag (e.g., "x <5 y" or "a <- b"), treat '<' as plain text
            tokens.push({ type: 'text', content: '<' });
            i++;
            continue;
        }

        // 3. Find closing '>'
        const closeBracket = html.indexOf('>', i);
        if (closeBracket === -1) {
            // Unclosed tag: treat remaining input as text
            tokens.push({ type: 'text', content: html.slice(i) });
            break;
        }

        // 4. Extract valid tag name character-by-character
        const nameStart = isEndTag ? i + 2 : i + 1;
        let nameEnd = nameStart;

        while (nameEnd < closeBracket && isValidTagChar(html[nameEnd])) {
            nameEnd++;
        }

        const tagName = html.slice(nameStart, nameEnd).toLowerCase();

        if (isEndTag) {
            tokens.push({ type: 'endTag', tag: tagName });
        } else {
            tokens.push({ type: 'startTag', tag: tagName });
        }

        // Move pointer past '>'
        i = closeBracket + 1;
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
