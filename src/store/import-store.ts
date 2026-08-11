import { nanoid } from 'nanoid';
import { create } from 'zustand';
import {
  parseDelimitedTable,
  type DelimitedFormat,
  type ParseDelimitedTableResult,
} from '@/core/import/parse-table';
import type {
  ColumnMapping,
  DecisionRule,
  ImportProfile,
  MissingRowPolicy,
  TagRule,
  UnpivotDimension,
} from '@/core/import/profile';

/**
 * Estado de UI do assistente de carga — Zustand puro (docs/07-ux-e-editor.md
 * §14). O documento nunca é tocado daqui: os componentes do passo 3 disparam
 * `useDocumentStore().dispatch(...)` diretamente, do mesmo jeito que
 * `CreateVariableDialog`/`VariableDetail` já fazem. O `profile` construído
 * aqui nunca é gravado em `importProfiles` (schema só na S23) — ele só
 * alimenta `validateProfile`/`resolveImport`/`planImport` em memória.
 *
 * `code`/`name` do perfil não têm campo próprio no assistente porque salvar
 * um perfil nomeado é US-08 (S24) — usamos um placeholder estável só para
 * satisfazer o schema de `ImportProfile`.
 */

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

function emptyProfile(): ImportProfile {
  return {
    id: nanoid(12),
    code: 'CARGA_EM_ANDAMENTO',
    name: 'Carga em andamento',
    createdAt: '1970-01-01T00:00:00.000Z',
    format: { delimiter: ';', headerRow: 1, hasBom: false, trimValues: true },
    signature: [],
    projectId: '',
    columns: [],
    codeTemplate: '',
    nameTemplate: '',
    decisionRules: [],
    tagRules: [],
    missingRowPolicy: 'KEEP',
    suppressUnobserved: true,
  };
}

interface ImportWizardState {
  step: WizardStep;
  fileName?: string;
  rawText?: string;
  formatOverride: Partial<DelimitedFormat>;
  parsed?: ParseDelimitedTableResult;
  profile: ImportProfile;
  recognizedProfile?: ImportProfile;
  dirty: boolean;

  setStep: (step: WizardStep) => void;
  loadText: (text: string, fileName?: string) => void;
  setFormatOverride: (patch: Partial<DelimitedFormat>) => void;
  updateColumn: (column: string, patch: Partial<ColumnMapping>) => void;
  setUnpivot: (unpivot: UnpivotDimension | undefined) => void;
  setCodeTemplate: (value: string) => void;
  setNameTemplate: (value: string) => void;
  setDecisionRules: (rules: DecisionRule[]) => void;
  setMissingRowPolicy: (policy: MissingRowPolicy) => void;
  setTagRules: (rules: TagRule[]) => void;
  setProjectId: (projectId: string) => void;
  setRecognizedProfile: (profile: ImportProfile | undefined) => void;
  jumpToPlan: () => void;
  reset: () => void;
}

function columnsFromHeader(header: readonly string[]): ColumnMapping[] {
  return header.map((column) => ({ column, role: 'IGNORE' }));
}

const initialState = {
  step: 1 as WizardStep,
  fileName: undefined as string | undefined,
  rawText: undefined as string | undefined,
  formatOverride: {} as Partial<DelimitedFormat>,
  parsed: undefined as ParseDelimitedTableResult | undefined,
  profile: emptyProfile(),
  recognizedProfile: undefined as ImportProfile | undefined,
  dirty: false,
};

export const useImportStore = create<ImportWizardState>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  loadText: (text, fileName) => {
    const { formatOverride, profile } = get();
    const parsed = parseDelimitedTable(text, formatOverride);
    set({
      rawText: text,
      fileName,
      parsed,
      profile: {
        ...profile,
        format: parsed.format,
        signature: parsed.header,
        columns: columnsFromHeader(parsed.header),
      },
      recognizedProfile: undefined,
      dirty: true,
    });
  },

  setFormatOverride: (patch) => {
    const { rawText, formatOverride, fileName } = get();
    const nextOverride = { ...formatOverride, ...patch };
    set({ formatOverride: nextOverride, dirty: true });
    if (rawText !== undefined) get().loadText(rawText, fileName);
  },

  updateColumn: (column, patch) => {
    const { profile } = get();
    set({
      profile: {
        ...profile,
        columns: profile.columns.map((entry) =>
          entry.column === column ? ({ ...entry, ...patch } as ColumnMapping) : entry,
        ),
      },
      dirty: true,
    });
  },

  setUnpivot: (unpivot) => {
    const { profile } = get();
    const withoutUnpivot: ImportProfile = { ...profile };
    delete withoutUnpivot.unpivot;
    set({
      profile: unpivot === undefined ? withoutUnpivot : { ...withoutUnpivot, unpivot },
      dirty: true,
    });
  },

  setCodeTemplate: (value) => {
    set((s) => ({ profile: { ...s.profile, codeTemplate: value }, dirty: true }));
  },

  setNameTemplate: (value) => {
    set((s) => ({ profile: { ...s.profile, nameTemplate: value }, dirty: true }));
  },

  setDecisionRules: (rules) => {
    set((s) => ({ profile: { ...s.profile, decisionRules: rules }, dirty: true }));
  },

  setMissingRowPolicy: (policy) => {
    set((s) => ({ profile: { ...s.profile, missingRowPolicy: policy }, dirty: true }));
  },

  setTagRules: (rules) => {
    set((s) => ({ profile: { ...s.profile, tagRules: rules }, dirty: true }));
  },

  setProjectId: (projectId) => {
    set((s) => ({ profile: { ...s.profile, projectId }, dirty: true }));
  },

  setRecognizedProfile: (recognizedProfile) => set({ recognizedProfile }),

  jumpToPlan: () => {
    const { recognizedProfile } = get();
    if (recognizedProfile === undefined) return;
    set({ profile: recognizedProfile, step: 5, dirty: true });
  },

  reset: () => set({ ...initialState, profile: emptyProfile() }),
}));
