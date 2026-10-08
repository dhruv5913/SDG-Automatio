// DSL language feature tests — node dev/dsl_test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
['js/dsl/tokenizer.js', 'js/dsl/parser.js', 'js/dsl/interpreter.js'].forEach(f =>
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }));
const SDG = globalThis.SDG;

let pass = 0, fail = 0;

function run(code) {
  const out = [];
  const ctx = {
    env: new SDG.Env(null),
    ops: { n: 0 },
    hasHost: () => false,
    host: () => { throw new Error('no host'); },
    print: m => out.push(m)
  };
  const gen = SDG.run(SDG.parse(code), ctx);
  let guard = 0;
  for (;;) {
    const s = gen.next();
    if (s.done) break;
    if (++guard > 500000) throw new Error('runaway');
  }
  return out;
}

function expect(name, code, expected) {
  try {
    const got = run(code).join('|');
    if (got === expected) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + ' — expected "' + expected + '" got "' + got + '"'); }
  } catch (e) {
    fail++; console.log('FAIL ' + name + ' — threw: ' + e.message);
  }
}

function expectError(name, code, msgPart) {
  try {
    run(code);
    fail++; console.log('FAIL ' + name + ' — expected error, none thrown');
  } catch (e) {
    if (e.message.includes(msgPart)) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + ' — error "' + e.message + '" missing "' + msgPart + '"'); }
  }
}

expect('arithmetic + precedence', 'print(2 + 3 * 4)', '14');
expect('floats', 'print(7 / 2)', '3.5');
expect('floor div', 'print(7 // 2)', '3');
expect('modulo', 'print(7 % 3)', '1');
expect('power', 'print(2 ** 5)', '32');
expect('comparison', 'print(3 < 5 and 2 >= 2)', 'True');
expect('chained comparison', 'print(1 < 2 < 3)', 'True');
expect('not / or', 'print(not False or True)', 'True');
expect('if elif else', 'x = 5\nif x > 10:\n    print("big")\nelif x > 3:\n    print("mid")\nelse:\n    print("small")', 'mid');
expect('while + break', 'i = 0\nwhile True:\n    i += 1\n    if i >= 4:\n        break\nprint(i)', '4');
expect('while + continue', 'i = 0\nn = 0\nwhile i < 5:\n    i += 1\n    if i % 2 == 0:\n        continue\n    n += 1\nprint(n)', '3');
expect('for range', 't = 0\nfor i in range(5):\n    t += i\nprint(t)', '10');
expect('for range start/step', 'r = ""\nfor i in range(1, 10, 3):\n    r += str(i)\nprint(r)', '147');
expect('function + return', 'def add(a, b):\n    return a + b\nprint(add(2, 3))', '5');
expect('default args', 'def f(a, b=10):\n    return a + b\nprint(f(1))', '11');
expect('default overridden', 'def f(a, b=10):\n    return a + b\nprint(f(1, 2))', '3');
expect('keyword args', 'def f(a, b=10):\n    return a + b\nprint(f(b=5, a=1))', '6');
expect('recursion', 'def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\nprint(fib(10))', '55');
expect('nested scopes / outer var read', 'x = 7\ndef f():\n    return x * 2\nprint(f())', '14');
expect('function assignment is local (python semantics)', 'x = 1\ndef f():\n    x = 9\n    return x\nprint(f())\nprint(x)', '9|1');
expect('lists + index', 'a = [1, 2, 3]\na[1] = 9\nprint(a[1], len(a))', '9 3');
expect('negative index', 'a = [1, 2, 3]\nprint(a[-1])', '3');
expect('string ops', 's = "sdg" * 2\nprint(s, len(s))', 'sdgsdg 6');
expect('while expression loop', 'i = 0\nwhile i < 3:\n    i += 1\nprint(i)', '3');
expect('one-liner if', 'x = 1\nif x: print("yes")', 'yes');
expect('nested functions', 'def outer():\n    def inner():\n        return 5\n    return inner() * 2\nprint(outer())', '10');
expect('augmented assign ops', 'x = 10\nx -= 3\nx *= 2\nx /= 4\nprint(x)', '3.5');
expect('comments and blank lines', '# comment\n\nx = 2  # trailing\nprint(x)', '2');
expect('line continuation in parens', 'print((1 +\n       2))', '3');
expect('empty program', '', '');

expectError('undefined name', 'print(y)', "'y' is not defined");
expectError('division by zero', 'print(1 / 0)', 'division by zero');
expectError('missing argument', 'def f(a):\n    return a\nf()', "missing argument 'a'");
expectError('too many args', 'def f(a):\n    return a\nf(1, 2)', 'too many arguments');
expectError('bad keyword', 'def f(a):\n    return a\nf(b=1)', 'unexpected keyword');
expectError('index out of range', 'a = [1]\nprint(a[5])', 'index out of range');
expectError('syntax error has line', 'def broken(:', 'Syntax error');
expectError('ops budget', 'while True:\n    x = 1', 'execution budget exceeded');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
