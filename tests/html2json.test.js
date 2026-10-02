// html2json.test.js
// Run: node tests/html2json.test.js (optional: SEED=<n> to reproduce the fuzzer)

const fs = require('fs');
const path = require('path');
const { html2json } = require('../html2json');

let failures = 0;

/**
 * Prints ✅ or ❌ for a single check and counts failures.
 * @param {string} name
 * @param {boolean} condition
 * @param {*} [details] printed only when the check fails
 */
function check(name, condition, details) {
    if (condition) {
        console.log(`✅ ${name}`);
    } else {
        failures++;
        console.error(`❌ ${name}`);
        if (details !== undefined) console.error(details);
    }
}

/**
 * Checks the invariants every html2json result must satisfy.
 * @param {*} res
 * @returns {boolean}
 */
function isValidRoot(res) {
    return (
        !!res &&
        res.type === 'root' &&
        Array.isArray(res.children) &&
        res.error === undefined
    );
}

console.log('=== 1. Basic correctness ===');

const r1 = html2json('<p>x</p>');
check(
    '<p>x</p> parses to a single <p>',
    r1.children?.length === 1 && r1.children[0].tag === 'p',
    r1,
);

const r2 = html2json('<div class="test"><span id="1">Hello</span></div>');
check(
    'nested text is parsed correctly',
    r2.children[0]?.children[0]?.children[0]?.content === 'Hello',
    r2,
);

console.log('\n=== 2. Feature tests ===');

const featureCases = [
    // Attributes
    {
        name: 'attribute value may contain ">"',
        input: '<a title="a > b">x</a>',
        expect: (r) =>
            r.children[0].attributes.title === 'a > b' &&
            r.children[0].children[0].content === 'x',
    },
    {
        name: 'duplicate attribute: first wins',
        input: '<div class="a" class="b">',
        expect: (r) => r.children[0].attributes.class === 'a',
    },
    {
        name: 'attribute names are lowercased; unquoted and boolean values',
        input: '<input DISABLED value=5>',
        expect: (r) =>
            r.children[0].attributes.disabled === '' &&
            r.children[0].attributes.value === '5',
    },
    {
        name: '__proto__ and constructor are stored as plain attributes',
        input: '<div __proto__="x" constructor="y">',
        expect: (r) => {
            const attrs = r.children[0].attributes;
            return (
                Object.prototype.hasOwnProperty.call(attrs, '__proto__') &&
                attrs.__proto__ === 'x' &&
                attrs.constructor === 'y' &&
                Object.getPrototypeOf(attrs) === null
            );
        },
    },

    // Void and self-closing elements
    {
        name: 'void element <br> does not swallow following siblings',
        input: '<br><p>x</p>',
        expect: (r) =>
            r.children.length === 2 &&
            r.children[0].children.length === 0 &&
            r.children[1].tag === 'p',
    },
    {
        name: '/> closes SVG elements',
        input: '<svg><circle r="1"/><rect/></svg>',
        expect: (r) =>
            r.children[0].children.length === 2 &&
            r.children[0].children.every((c) => c.children.length === 0),
    },
    {
        name: 'tag names are lowercased',
        input: '<DIV>x</div>',
        expect: (r) =>
            r.children.length === 1 && r.children[0].tag === 'div',
    },

    // Comments and doctype
    {
        name: 'comment keeps its content',
        input: '<!-- hi -->',
        expect: (r) =>
            r.children[0].type === 'comment' &&
            r.children[0].content === ' hi ',
    },
    {
        name: 'doctype is a separate node',
        input: '<!DOCTYPE html><p>x</p>',
        expect: (r) =>
            r.children[0].type === 'doctype' &&
            r.children[0].content === 'html' &&
            r.children[1].tag === 'p',
    },

    // Raw text and RCDATA
    {
        name: 'script content with "<" stays raw text',
        input: '<script>if (a < b) {}</script>',
        expect: (r) =>
            r.children[0].children.length === 1 &&
            r.children[0].children[0].content === 'if (a < b) {}',
    },
    {
        name: '</scriptx> does not close <script>',
        input: '<script>a</scriptx>b</script>',
        expect: (r) => r.children[0].children[0].content === 'a</scriptx>b',
    },
    {
        name: 'script does not decode entities',
        input: '<script>&amp;</script>',
        expect: (r) => r.children[0].children[0].content === '&amp;',
    },
    {
        name: 'textarea decodes entities and does not parse tags',
        input: '<textarea>&lt;b&gt;<i></textarea>',
        expect: (r) =>
            r.children[0].children.length === 1 &&
            r.children[0].children[0].content === '<b><i>',
    },

    // Entities
    {
        name: 'named, decimal and hex entities are decoded',
        input: '<p>&copy; &#169; &#xA9;</p>',
        expect: (r) => r.children[0].children[0].content === '© © ©',
    },
    {
        name: '&amp;lt; decodes once to &lt;',
        input: '&amp;lt;',
        expect: (r) => r.children[0].content === '&lt;',
    },
    {
        name: 'entities in attribute values are decoded',
        input: '<a href="?a=1&amp;b=2">x</a>',
        expect: (r) => r.children[0].attributes.href === '?a=1&b=2',
    },
    {
        name: 'unknown entity stays unchanged',
        input: 'a &unknown; b',
        expect: (r) => r.children[0].content === 'a &unknown; b',
    },

    // Implicit closing
    {
        name: '<li> closes the previous <li>',
        input: '<ul><li>a<li>b</ul>',
        expect: (r) =>
            r.children[0].children.length === 2 &&
            r.children[0].children.every((c) => c.tag === 'li'),
    },
    {
        name: '<div> closes an open <p>',
        input: '<p>a<div>b</div>',
        expect: (r) =>
            r.children.length === 2 &&
            r.children[0].tag === 'p' &&
            r.children[1].tag === 'div',
    },
    {
        name: 'table rows and cells close implicitly',
        input: '<table><tr><td>1<td>2<tr><td>3</table>',
        expect: (r) => {
            const rows = r.children[0].children;
            return (
                rows.length === 2 &&
                rows[0].children.length === 2 &&
                rows[1].children.length === 1
            );
        },
    },
    {
        name: '</div> closes an unclosed <p> inside it',
        input: '<div><p>Hi</div>after',
        expect: (r) =>
            r.children.length === 2 &&
            r.children[0].children[0].tag === 'p' &&
            r.children[1].content === 'after',
    },

    // Whitespace
    {
        name: 'whitespace between elements is kept as a text node',
        input: '<p>a</p>\n<p>b</p>',
        expect: (r) =>
            r.children.length === 3 &&
            r.children[1].type === 'text' &&
            r.children[1].content === '\n',
    },

    // Malformed input
    {
        name: '"<" not followed by a letter is text',
        input: '5 < 6',
        expect: (r) =>
            r.children.length === 1 && r.children[0].content === '5 < 6',
    },
    {
        name: 'stray end tag is ignored',
        input: '</span>x',
        expect: (r) =>
            r.children.length === 1 && r.children[0].content === 'x',
    },
];

for (const { name, input, expect } of featureCases) {
    const res = html2json(input);
    let ok;
    try {
        ok = expect(res);
    } catch {
        ok = false; // e.g. children[0] is undefined
    }
    check(name, ok, res);
}

console.log('\n=== 3. Stress tests and MAX_DEPTH (100,000 <div>) ===');
console.time('Parsing 100,000 deep divs');
const deepTree = html2json('<div>'.repeat(100000));
console.timeEnd('Parsing 100,000 deep divs');
check('deep tree has a valid root', isValidRoot(deepTree));

console.time('JSON.stringify of deep tree');
let jsonString;
try {
    jsonString = JSON.stringify(deepTree);
} catch (err) {
    jsonString = undefined;
    console.error(err.message);
}
console.timeEnd('JSON.stringify of deep tree');
check('JSON.stringify of deep tree does not overflow the stack', !!jsonString);

console.log('\n=== 4. Fuzzer (property-based testing, 10,000 iterations) ===');

/**
 * Small seeded PRNG so any fuzzer failure can be reproduced with SEED=<n>.
 * @param {number} seed
 * @returns {() => number} random number in [0, 1)
 */
function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function runPropertyBasedFuzzer(iterations, seed) {
    const random = mulberry32(seed);
    const chars = '<>/="\'!-&#ab \n\txyz123';
    const failedInputs = [];

    console.log(`Seed: ${seed} (rerun with SEED=${seed} to reproduce)`);
    console.time('Fuzzer Run Time');

    for (let i = 0; i < iterations; i++) {
        const len = Math.floor(random() * 40) + 1;
        let randomHtml = '';
        for (let j = 0; j < len; j++) {
            randomHtml += chars[Math.floor(random() * chars.length)];
        }

        try {
            const res = html2json(randomHtml);

            if (!isValidRoot(res)) {
                failedInputs.push({
                    input: randomHtml,
                    reason: 'Root structure invariant broken',
                    res,
                });
                continue;
            }

            if (!randomHtml.includes('<') && !randomHtml.includes('&')) {
                const isSingleTextNode =
                    res.children.length === 1 &&
                    res.children[0].type === 'text' &&
                    res.children[0].content === randomHtml;

                if (!isSingleTextNode) {
                    failedInputs.push({
                        input: randomHtml,
                        reason: 'Plain text input changed output structure',
                        res,
                    });
                }
            }
        } catch (err) {
            failedInputs.push({
                input: randomHtml,
                reason: `Crash: ${err.message}`,
            });
        }
    }

    console.timeEnd('Fuzzer Run Time');
    check(
        `fuzzer: ${iterations - failedInputs.length}/${iterations} inputs passed`,
        failedInputs.length === 0,
        failedInputs.slice(0, 5),
    );
}

let seed = Math.floor(Math.random() * 2 ** 32);
if (process.env.SEED !== undefined) {
    const envSeed = Number(process.env.SEED);
    // A NaN seed makes the generator return 0 forever, so the fuzzer would test one input
    check(
        `SEED=${process.env.SEED} is an integer`,
        Number.isInteger(envSeed),
    );
    if (Number.isInteger(envSeed)) seed = envSeed;
}
runPropertyBasedFuzzer(10000, seed);

console.log('\n=== 5. Invalid inputs ===');
const invalidInputs = [null, undefined, 123, {}, [], ''];

for (const input of invalidInputs) {
    const res = html2json(input);
    check(
        `invalid input ${JSON.stringify(input) ?? String(input)} gives an empty root`,
        isValidRoot(res) && res.children.length === 0,
        res,
    );
}

console.log('\n=== 6. Abruptly closed empty comments ===');
for (const input of ['<!--><p>Hello</p>', '<!---><p>Hello</p>']) {
    const res = html2json(input);
    check(
        input,
        res.children.length === 2 &&
            res.children[0].type === 'comment' &&
            res.children[0].content === '' &&
            res.children[1].tag === 'p',
        res,
    );
}

console.log('\n=== 7. Weird inputs ===');
const weirdInputs = {
    '100,000 "<"': '<'.repeat(100000),
    '100,000 "&"': '&'.repeat(100000),
    '10,000 "<!--"': '<!--'.repeat(10000),
    '10,000 unclosed attributes': '<a href="'.repeat(10000),
};

for (const [name, input] of Object.entries(weirdInputs)) {
    console.time(name);
    const res = html2json(input);
    console.timeEnd(name);
    check(`${name} gives a valid root`, isValidRoot(res), res.error);
}

console.log('\n=== 8. Samples from html_samples/ ===');
const samplesDir = path.join(__dirname, '../html_samples');
const samplesDirExists = fs.existsSync(samplesDir);
check('html_samples/ folder exists', samplesDirExists);

const sampleFiles = samplesDirExists
    ? fs
          .readdirSync(samplesDir)
          .filter((file) => file.endsWith('.html') || file.endsWith('.htm'))
    : [];
check(
    `html_samples/ contains sample files (${sampleFiles.length} found)`,
    sampleFiles.length > 0,
);

for (const file of sampleFiles) {
    const htmlContent = fs.readFileSync(path.join(samplesDir, file), 'utf-8');
    const res = html2json(htmlContent);
    check(`sample ${file}`, isValidRoot(res), res);
}

console.log(
    `\n${failures === 0 ? '✅ All tests passed' : `❌ ${failures} test(s) failed`}`,
);
process.exitCode = failures > 0 ? 1 : 0;
