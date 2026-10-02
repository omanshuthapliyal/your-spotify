import { strToU8 } from 'fflate';
import { extendedFixtureFiles, extendedFixtureZip } from '../../fixtures/synthetic';
import { importFiles, type InputFile } from '../../src/core/importer';

export const NOW = Date.UTC(2026, 0, 1);

export function fixtureInputs(): InputFile[] {
  return extendedFixtureFiles().map((f) => ({ name: f.name, bytes: strToU8(f.content) }));
}
export function fixtureZipInput(): InputFile {
  return { name: 'my_spotify_data.zip', bytes: extendedFixtureZip() };
}
export async function importFixture() {
  return importFiles(fixtureInputs(), { nowMs: NOW });
}
