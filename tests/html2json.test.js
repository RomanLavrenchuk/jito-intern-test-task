// html2json.test.js
const { html2json } = require('../html2json.js');

console.clear();
console.log('=== 1. Basic correctness (assertions) ===');

const r1 = html2json('<p>x</p>');
console.assert(
    r1.children && r1.children.length === 1 && r1.children[0].tag === 'p',
    '❌ Error: parser returned an incorrect result for <p>x</p>',
    r1,
);

const r2 = html2json('<div class="test"><span id="1">Hello</span></div>');
console.assert(
    r2.children[0]?.children[0]?.children[0]?.content === 'Hello',
    '❌ Error: nested text was parsed incorrectly',
    r2,
);

if (
    r1.children &&
    r1.children.length === 1 &&
    r1.children[0].tag === 'p' &&
    r2.children[0]?.children[0]?.children[0]?.content === 'Hello'
) {
    console.log('✅ All console.assert checks passed. Basic parsing works.');
}

console.log('\n=== 2. Stress tests and MAX_DEPTH (100,000 <div>) ===');
console.time('Parsing 100,000 deep divs');
const deepTree = html2json('<div>'.repeat(100000));
console.timeEnd('Parsing 100,000 deep divs');

console.time('JSON.stringify of deep tree');
try {
    const jsonString = JSON.stringify(deepTree);
    console.log('✅ JSON.stringify succeeded without a stack overflow.');
    console.log(`Resulting JSON length: ${jsonString.length} characters`);
} catch (err) {
    console.error('❌ JSON.stringify failed:', err.message);
}
console.timeEnd('JSON.stringify of deep tree');

console.log('\n=== 3. Fuzzer (property-based testing, 10,000 iterations) ===');

function runPropertyBasedFuzzer(iterations = 10000) {
    const chars = '<>/="\'!-&#ab \n\txyz123';
    let failures = 0;
    const failedInputs = [];

    console.time('Fuzzer Run Time');

    for (let i = 0; i < iterations; i++) {
        const len = Math.floor(Math.random() * 40) + 1;
        let randomHtml = '';
        for (let j = 0; j < len; j++) {
            randomHtml += chars[Math.floor(Math.random() * chars.length)];
        }

        try {
            const res = html2json(randomHtml);

            if (
                !res ||
                res.type !== 'root' ||
                !Array.isArray(res.children) ||
                res.error
            ) {
                failures++;
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
                    failures++;
                    failedInputs.push({
                        input: randomHtml,
                        reason: 'Property-Based test failed: Plain text input changed output structure',
                        res,
                    });
                }
            }
        } catch (err) {
            failures++;
            failedInputs.push({
                input: randomHtml,
                reason: `Crash: ${err.message}`,
            });
        }
    }

    console.timeEnd('Fuzzer Run Time');
    console.log(
        `\nFuzzer result: ${iterations - failures}/${iterations} tests passed.`,
    );

    if (failures > 0) {
        console.error(
            `❌ Found ${failures} failures:`,
            failedInputs.slice(0, 5),
        );
    } else {
        console.log(
            '✅ All property-based fuzzer tests passed with no failures.',
        );
    }
}

runPropertyBasedFuzzer(10000);

console.log('\n=== Invalid inputs ===');
const invalidInputs = [null, undefined, 123, {}, [], ''];

for (const input of invalidInputs) {
    const res = html2json(input);
    const ok =
        res.type === 'root' &&
        Array.isArray(res.children) &&
        res.children.length === 0 &&
        !res.error;
    console.log(ok ? '✅' : '❌', JSON.stringify(input) ?? String(input));
}

console.log('\n=== Abruptly closed empty comments ===');
for (const input of ['<!--><p>Hello</p>', '<!---><p>Hello</p>']) {
    const res = html2json(input);
    const ok =
        res.children.length === 2 &&
        res.children[0].type === 'comment' &&
        res.children[0].content === '' &&
        res.children[1].tag === 'p';
    console.log(ok ? '✅' : '❌', input);
}

console.log('\n=== Weird inputs ===');
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
    console.log(res.error ? `❌ ${res.error}` : '✅ no error');
}
