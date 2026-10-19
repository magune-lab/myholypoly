import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readJsonFile } from '../src/services/json-storage.mjs';

const fallback = { version: 1, plans: {} };
const isValidPlan = value => value && typeof value === 'object'
  && !Array.isArray(value) && value.plans && typeof value.plans === 'object'
  && !Array.isArray(value.plans);

test('returns a fresh fallback only when the data file is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'myholypoly-storage-'));
  try {
    const first = await readJsonFile(join(directory, 'missing.json'), fallback, isValidPlan, '숙제 데이터');
    first.plans.changed = true;
    const second = await readJsonFile(join(directory, 'missing.json'), fallback, isValidPlan, '숙제 데이터');
    assert.deepEqual(second, fallback);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reads valid data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'myholypoly-storage-'));
  try {
    const filePath = join(directory, 'plan.json');
    const plan = { version: 1, plans: { '2026-10-19': { items: [] } } };
    await writeFile(filePath, JSON.stringify(plan));
    assert.deepEqual(await readJsonFile(filePath, fallback, isValidPlan, '숙제 데이터'), plan);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects corrupt data without changing the original file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'myholypoly-storage-'));
  try {
    const filePath = join(directory, 'plan.json');
    const corruptContents = '{"plans":';
    await writeFile(filePath, corruptContents);
    await assert.rejects(
      readJsonFile(filePath, fallback, isValidPlan, '숙제 데이터'),
      /JSON이 손상되어 읽을 수 없습니다/
    );
    assert.equal(await readFile(filePath, 'utf8'), corruptContents);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects valid JSON with an invalid data shape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'myholypoly-storage-'));
  try {
    const filePath = join(directory, 'plan.json');
    await writeFile(filePath, JSON.stringify({ version: 1, plans: [] }));
    await assert.rejects(
      readJsonFile(filePath, fallback, isValidPlan, '숙제 데이터'),
      /파일 형식이 올바르지 않습니다/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
