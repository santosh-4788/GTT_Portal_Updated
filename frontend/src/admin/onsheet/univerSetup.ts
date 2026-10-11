/**
 * Univer, loaded only by the OnSheet editor (through a dynamic import), so the
 * rest of the portal never downloads the spreadsheet engine or its styles.
 *
 * Open-source presets only: sheets core (with the formula engine running on
 * the main thread), filter, sort, conditional formatting, find & replace and
 * data validation.
 */
import { createUniver, LocaleType, mergeLocales, defaultTheme, CommandType } from '@univerjs/presets';
import type { FUniver, IWorkbookData } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import sheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import sheetsSortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import sheetsCfEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US';
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace';
import sheetsFindEnUS from '@univerjs/preset-sheets-find-replace/locales/en-US';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import sheetsDvEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US';

import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import '@univerjs/preset-sheets-find-replace/lib/index.css';
import '@univerjs/preset-sheets-data-validation/lib/index.css';

export interface MountedSheet {
  univerAPI: FUniver;
  /** Current workbook snapshot (IWorkbookData). */
  snapshot: () => IWorkbookData;
  /** Id of the sheet tab the user is on. */
  activeSheetId: () => string | null;
  dispose: () => void;
}

/**
 * Mutations that do not change the document: formula results, dirty marks
 * and layout the engine works out by itself on every load.
 */
function changesDocument(id: string, options: any): boolean {
  if (options?.onlyLocal || options?.fromCollab || options?.fromFormula) return false;
  if (id.startsWith('formula.mutation.')) return false;
  if (id.includes('mark-dirty')) return false;
  if (id === 'sheet.mutation.set-worksheet-row-auto-height') return false;
  if (id === 'sheet.mutation.set-worksheet-permission-points') return false;
  return true;
}

export function mountUniver(
  container: HTMLElement,
  data: IWorkbookData,
  opts: { readOnly: boolean; onChange: () => void },
): MountedSheet {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS, sheetsFilterEnUS, sheetsSortEnUS, sheetsCfEnUS, sheetsFindEnUS, sheetsDvEnUS),
    },
    theme: defaultTheme,
    presets: [
      UniverSheetsCorePreset({ container, header: true, toolbar: true, footer: undefined, formulaBar: true }),
      UniverSheetsFilterPreset(),
      UniverSheetsSortPreset(),
      UniverSheetsConditionalFormattingPreset(),
      UniverSheetsFindReplacePreset(),
      UniverSheetsDataValidationPreset(),
    ],
  });

  const workbook = univerAPI.createWorkbook(data);

  if (opts.readOnly) {
    try { workbook.setEditable(false); } catch { /* older API */ }
    try { void workbook.getWorkbookPermission().setReadOnly(); } catch { /* permission service missing */ }
  }

  // Loading a workbook fires a burst of layout/formula mutations. Nothing the
  // user did, so they are not "unsaved changes".
  let settled = false;
  const settle = window.setTimeout(() => { settled = true; }, 1200);

  const sub = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (e) => {
    if (!settled || opts.readOnly) return;
    if (e.type !== CommandType.MUTATION) return;
    if (!changesDocument(e.id, e.options)) return;
    opts.onChange();
  });

  return {
    univerAPI,
    snapshot: () => workbook.save(),
    activeSheetId: () => {
      try { return workbook.getActiveSheet().getSheetId(); } catch { return null; }
    },
    dispose: () => {
      window.clearTimeout(settle);
      try { sub.dispose(); } catch { /* already gone */ }
      try { univer.dispose(); } catch { /* already gone */ }
    },
  };
}
