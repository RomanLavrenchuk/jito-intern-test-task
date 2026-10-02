# html2json

`html2json(html)` turns an HTML string into a tree of plain objects that can be passed to `JSON.stringify`. The parser is written from scratch: it does not use `DOMParser` or any other DOM or HTML parsing library. It never throws. Any input, including non-strings and badly broken markup, gives back a valid `root` node.

The original task description is in the [Jito test task template](https://jito-dev.github.io/jito-intern-test-task/).

## How to run

- **In the browser:** open `index.html`, paste HTML into the left field and click the convert button. You can also load one of the two built-in examples.
- **Tests:** `node tests/html2json.test.js` (no dependencies needed).
  - The fuzzer uses a random seed on each run and prints it. To repeat a run exactly, pass that seed: `SEED=<n> node tests/html2json.test.js`.

## Repository structure

```text
.
├── index.html               # UI provided by Jito, unchanged
├── html2json.js             # the parser plus Jito's UI glue code; also exported for Node.js
├── tests/
│   └── html2json.test.js    # feature tests, stress tests, seeded fuzzer, sample checks
├── html_samples/            # 12 HTML files, each covering one group of edge cases
│   ├── 01-basic-nesting.html
│   ├── ...
│   └── 12-real-world-page.html
├── ai_help/                 # the full AI conversation used for this task (see "Use of AI")
└── README.md
```

## Output format

Input:

```html
<!-- note --><p class="intro">Hi &amp; <b>bye</b></p>
```

Output:

```json
{
  "type": "root",
  "children": [
    { "type": "comment", "content": " note " },
    {
      "type": "element",
      "tag": "p",
      "attributes": { "class": "intro" },
      "children": [
        { "type": "text", "content": "Hi & " },
        {
          "type": "element",
          "tag": "b",
          "attributes": {},
          "children": [{ "type": "text", "content": "bye" }]
        }
      ]
    }
  ]
}
```

| `type`    | Fields                                   | Notes |
|-----------|------------------------------------------|-------|
| `root`    | `children`, optional `error`             | Always the top node. `error` is only set if parsing threw unexpectedly. |
| `element` | `tag`, `attributes`, `children`          | `attributes` is `{}` and `children` is `[]` when empty. They are never missing. |
| `text`    | `content`                                | Entities are decoded. Adjacent text is merged into one node. |
| `comment` | `content`                                | Text between `<!--` and `-->`. Also used for bogus comments such as `<!...>` and `<?...>`. |
| `doctype` | `content`                                | E.g. `"html"` for `<!DOCTYPE html>`. |

## Decisions and reasoning

**A `children` array with typed nodes, not tags as object keys.** A shape like `{ "div": { "p": ... } }` looks shorter, but it cannot represent:

- two sibling elements with the same tag (the second key would overwrite the first),
- reliable order,
- mixed content such as `Hi <b>bye</b>!`, where text and elements are interleaved.

An ordered array of nodes, each with a `type`, handles all three.

**A `root` node at the top.** The input can be a fragment with several top-level nodes (`<p>a</p><p>b</p>`) or just text. Having one root means the return type is always the same, whatever the input is.

**Whitespace is preserved.** Whitespace-only text between tags is kept as text nodes. Whitespace can matter (`<pre>`, inline elements, CSS `white-space`), and the parser cannot know which whitespace is significant. So no text content is dropped, and filtering whitespace is left to the consumer.

**`attributes: {}` and `children: []` are always present.** Every element has the same shape. Consumers can write `node.children.length` without checking whether the field exists first.

**Tag and attribute names are lowercased; attribute values are not.** HTML names are case-insensitive, so `<DIV>` and `<div>` should give the same output. Values (`class="Foo"`, URLs) are case-sensitive and are kept exactly as written.

**On duplicate attributes, the first one wins; attributes use `Object.create(null)`.** Browsers keep the first occurrence of a duplicate attribute, so this parser does too. The attribute object has no prototype, so an attribute named `__proto__` or `constructor` is stored as ordinary data. It cannot change the object's prototype or hide an inherited property.

**Two stages: tokenizer → tree builder, with no recursion.** `tokenize()` turns the string into a flat list of tokens. `buildTree()` builds the tree from those tokens using an explicit stack. Keeping the stages apart means each one can be understood and tested on its own. Neither stage is recursive, so deep nesting cannot overflow the call stack.

**`/>` is honoured on every tag.** In HTML, `/>` is ignored on non-void elements. But SVG and MathML elements are commonly written as `<circle/>` and `<path/>`. If `/>` were ignored there, each of those elements would swallow every sibling after it. Treating `/>` as "close immediately" gives the result the author meant.

**RAW TEXT and RCDATA elements.** Inside `<script>` and `<style>` (RAW TEXT), everything up to the matching closing tag is one text node, and entities are **not** decoded, so `if (a < b && c)` stays intact. Inside `<textarea>` and `<title>` (RCDATA), tags are not parsed either, but entities **are** decoded, as browsers do. The closing tag must match the full name (`</scriptx>` does not close `<script>`) and is matched case-insensitively.

**Entities:**

- An entity is only decoded when it ends with `;`. Without the `;`, the text stays as written, so `?a=1&b=2` is not changed.
- Named entities come from a short list of common ones (`&amp;`, `&lt;`, `&copy;`, `&nbsp;`, …). Unknown names are left unchanged rather than guessed.
- Numeric references (`&#169;`, `&#xA9;`) that are 0, a surrogate, or above U+10FFFF become `�` (U+FFFD), as in browsers, instead of throwing.
- Decoding happens in a single pass, so `&amp;lt;` becomes `&lt;`, not `<`.

**Implicit closing and closing-tag search.**

- When certain tags open, they close an element that is still open: `<li>` closes the previous `<li>`, `<dt>`/`<dd>` close the previous `<dt>` or `<dd>`, `<option>` closes the previous `<option>`, `<td>`/`<th>` close the previous cell, `<tr>` closes the previous row together with its open cell, and block elements such as `<div>` close an open `<p>`. Only the top of the stack is checked.
- An end tag closes the nearest open element with the same name, together with everything opened inside it. So `<div><p>Hi</div>` closes both. An end tag that matches nothing open is ignored.

**`MAX_DEPTH = 512`.** Chrome uses the same nesting limit. The parser itself has no recursion, but `JSON.stringify` does. Without a limit, 100,000 nested `<div>`s would build a tree that crashes `JSON.stringify` in the UI. Elements beyond depth 512 are added as siblings at the deepest allowed level, so no content is lost.

**Never throwing.** Non-string input (`null`, numbers, objects) returns an empty `root`. As a last safety net, `html2json` wraps parsing in `try/catch`. If something unexpected throws, it returns an empty `root` with an `error` field instead of crashing the page. The tests check that this never actually happens.

**One file.** `index.html` loads only `html2json.js`, and it is meant to stay unchanged. So the parser, the provided UI functions and the Node.js export are all in that one file, split into labelled sections.

## Testing

`tests/html2json.test.js` uses only Node's built-in modules. It covers:

1. **Basic correctness:** simple and nested elements.
2. **Feature tests:** one or more checks for each decision above: attributes (`>` inside quotes, duplicates, case, `__proto__`), void and self-closing elements, comments and doctype, script and textarea content, entities, implicit closing, whitespace and malformed input.
3. **Stress test:** 100,000 nested `<div>`s. Parsing must be fast, and `JSON.stringify` of the result must not overflow.
4. **Fuzzer:** 10,000 random strings built from HTML-significant characters (`< > / = " ' ! - & #` …). For each one it checks that the call does not throw, that the root is valid, and that input without `<` or `&` comes back as exactly one text node.
   - The fuzzer uses a small seeded random number generator (mulberry32). Each run tries new inputs, and any failure can be reproduced exactly with `SEED=<n>`.
5. **Invalid input:** `null`, `undefined`, `123`, `{}`, `[]`, `''` all give an empty root.
6. **Empty comments `<!-->` and `<!--->`:** these end immediately and do not turn the rest of the document into a comment.
7. **Pathological input:** 100,000 `<`, 100,000 `&`, 10,000 `<!--`, 10,000 unclosed attributes. Each must return a valid root in reasonable time.
8. **Samples:** every file in `html_samples/` must parse to a valid root.

The script exits with code 1 if any check fails.

## Known limitations

This is a practical parser, not a full implementation of the WHATWG tree-construction algorithm. Known differences from a browser:

- **`</p>` with no open `<p>`** is ignored. A browser inserts an empty `<p></p>`.
- **`</br>`** is ignored. A browser treats it as `<br>`.
- **Misnested formatting tags** (`<b><i>x</b>y</i>`): `</b>` closes both, and `y` ends up outside them. Browsers run the "adoption agency" algorithm and reopen `<i>` around `y`.
- **Implicit closing checks only the top of the stack.** In `<p><span><div>`, the `<div>` ends up inside the `<span>`, which is still inside the `<p>`. A browser would close the `<p>` first.
- **No implied elements.** `<tbody>` is not inserted into tables. `<html>`, `<head>` and `<body>` are not created when they are missing.
- **`\r\n` is not normalized** to `\n`. Text keeps the original line endings.
- **Limited named entities.** Only a short list is decoded. Other valid entities such as `&alpha;` stay as written.
- **SVG names are lowercased.** Both tag names (`<linearGradient>` → `lineargradient`) and attribute names (`viewBox` → `viewbox`) are lowercased, because the same rule applies to every element.

## Use of AI

AI use was required for this task. I used Claude throughout, and the **complete conversation is in `ai_help/`**:

- the share link is in `chatgpt_chat.txt` (the file name required by the task),
- a PDF export of the conversation is in `claude_chat.pdf`.

I also used Claude Code in VS Code for code review, refactoring and the tests. Those sessions are not part of the share link.

How I used it:

- **A step-by-step plan.** At the start I asked for a plan that split the work into small steps (tokenizing plain text, tags, attributes, the tree builder, comments, raw text, entities, implicit closing, tests, README). I then implemented and committed one step at a time. The git history follows the same order.
- **Explanations.** For each step I asked why browsers behave the way they do (RAW TEXT vs RCDATA, why `/>` matters for SVG, why `JSON.stringify` needs a depth limit) before deciding how my parser should handle it. The reasoning in this README comes from those discussions.
- **Review of every step.** After writing each part, I asked for a review and fixed the problems it found before moving on.
- **Finding bugs.** I used the AI to look for inputs that could break the parser. Examples are `<!-->` swallowing the rest of the document, `__proto__` as an attribute name, and invalid code points in numeric entities. Each one became a fix plus a test.
