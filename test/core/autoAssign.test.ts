import assert from 'node:assert/strict';
import test from 'node:test';
import { globToRegExp, matchAutoAssignRule, readAutoAssignRules } from '../../src/core/autoAssign';

test('a folder pattern matches everything under it and nothing beside it', () => {
  const pattern = globToRegExp('test/**', 'linux');

  assert.equal(pattern.test('test/a.ts'), true);
  assert.equal(pattern.test('test/deep/b.ts'), true);
  assert.equal(pattern.test('src/test.ts'), false);
});

test('a single star stays inside one folder', () => {
  const pattern = globToRegExp('src/*.ts', 'linux');

  assert.equal(pattern.test('src/a.ts'), true);
  assert.equal(pattern.test('src/deep/a.ts'), false);
});

test('a leading double star also matches the repository root', () => {
  const pattern = globToRegExp('**/*.test.ts', 'linux');

  // The point of the zero-folder case: a test file sitting at the top should
  // still be caught, without needing a second rule just for it.
  assert.equal(pattern.test('a.test.ts'), true);
  assert.equal(pattern.test('src/deep/a.test.ts'), true);
  assert.equal(pattern.test('a.ts'), false);
});

test('braces offer alternatives', () => {
  const pattern = globToRegExp('**/*.{css,scss}', 'linux');

  assert.equal(pattern.test('a.css'), true);
  assert.equal(pattern.test('src/a.scss'), true);
  assert.equal(pattern.test('src/a.less'), false);
});

test('dots are literal, not wildcards', () => {
  const pattern = globToRegExp('a.b.c', 'linux');

  assert.equal(pattern.test('a.b.c'), true);
  assert.equal(pattern.test('axbxc'), false);
});

test('an unbalanced brace is treated as an ordinary character', () => {
  // Better a rule that matches only what it says than one that quietly matches
  // far more than whoever wrote it meant.
  const pattern = globToRegExp('{unclosed', 'linux');

  assert.equal(pattern.test('{unclosed'), true);
  assert.equal(pattern.test('unclosed'), false);
});

test('a pattern with no slash is about the file name, wherever it sits', () => {
  const rules = readAutoAssignRules({ '*.md': 'Docs' });

  assert.equal(matchAutoAssignRule(rules, 'readme.md', 'linux')?.groupName, 'Docs');
  assert.equal(matchAutoAssignRule(rules, 'docs/deep/readme.md', 'linux')?.groupName, 'Docs');
});

test('a pattern with a slash is about the whole path', () => {
  const rules = readAutoAssignRules({ 'docs/*.md': 'Docs' });

  assert.equal(matchAutoAssignRule(rules, 'docs/readme.md', 'linux')?.groupName, 'Docs');
  assert.equal(matchAutoAssignRule(rules, 'other/readme.md', 'linux'), undefined);
});

test('the first matching rule wins', () => {
  const rules = readAutoAssignRules({ 'src/**': 'Source', 'src/api/**': 'Api' });

  // Order is the order in the settings file, so what you read top to bottom is
  // what happens. No specificity contest to work out in your head.
  assert.equal(matchAutoAssignRule(rules, 'src/api/x.ts', 'linux')?.groupName, 'Source');
});

test('matching ignores case on Windows and respects it elsewhere', () => {
  const rules = readAutoAssignRules({ 'src/**': 'Source' });

  assert.equal(matchAutoAssignRule(rules, 'Src/A.ts', 'win32')?.groupName, 'Source');
  assert.equal(matchAutoAssignRule(rules, 'Src/A.ts', 'linux'), undefined);
});

test('a path is matched with forward slashes whatever it arrives as', () => {
  const rules = readAutoAssignRules({ 'test/**': 'Tests' });

  assert.equal(matchAutoAssignRule(rules, 'test\\deep\\a.ts', 'win32')?.groupName, 'Tests');
});

test('a bad rule is skipped and the good ones survive', () => {
  const rules = readAutoAssignRules({
    'ok/**': 'Fine',
    'wrong-type/**': 42,
    '': 'No pattern',
    'blank-name/**': '   '
  });

  // One typo in settings should not turn the whole feature off.
  assert.deepEqual(rules, [{ pattern: 'ok/**', groupName: 'Fine' }]);
});

test('a setting that is not an object gives no rules at all', () => {
  assert.deepEqual(readAutoAssignRules(undefined), []);
  assert.deepEqual(readAutoAssignRules(['test/**']), []);
  assert.deepEqual(readAutoAssignRules('test/**'), []);
});

test('nothing matches an empty path', () => {
  assert.equal(matchAutoAssignRule(readAutoAssignRules({ '**': 'All' }), '', 'linux'), undefined);
});
