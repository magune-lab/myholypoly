import { readFile } from 'node:fs/promises';

export async function readJsonFile(filePath, fallback, isValid, invalidMessage) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }

  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${invalidMessage} JSON이 손상되어 읽을 수 없습니다. 기존 파일은 보존했습니다.`, { cause: error });
  }

  if (!isValid(value)) {
    throw new Error(`${invalidMessage} 파일 형식이 올바르지 않습니다. 기존 파일은 보존했습니다.`);
  }

  return value;
}
