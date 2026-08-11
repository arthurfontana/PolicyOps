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
import type { ApplyImportData } from '@/core/import/apply';

/**
 * Estado de UI do assistente de carga — Zustand puro (docs/07-ux-e-editor.md
 * §14). O documento nunca é tocado daqui: os componentes do passo 3 disparam
 * `useDocumentStore().dispatch(...)` diretamente, do mesmo jeito que
 * `CreateVariableDialog`/`VariableDetail` já fazem. O `profile` construído
 * aqui nunca é gravado em `importProfiles` (schema só na S23) — ele só
 * alimenta `validateProfile`/`resolveImport`/`planImport` em memória.
 *
 * `code`/`name` do perfil ganham campo próprio só no passo 6, ao salvar o
 * perfil (US-08); até lá vale um placeholder estável, que existe apenas para
 * satisfazer o schema de `ImportProfile` em memória.
 *
 * A seleção do passo 5, a nota da carga e o relatório da aplicação também
 * moram aqui: são estado de assistente, não do documento. "Revisado" é a
 * única exceção que fica no `ui-store`, porque sobrevive ao fechamento do
 * assistente (docs/12 §6.2).
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
  /**
   * O usuário viu a diferença de cabeçalho contra o perfil parecido e mandou
   * seguir no mapeamento manual (RN-19, CT-12). Sem isso o passo 1 não avança.
   */
  headerDiffAcknowledged: boolean;
  /** `MatrixPlan.key` marcadas no passo 5; `undefined` = ainda não tocado. */
  selectedKeys?: string[];
  notes: string;
  /** Preenchido ao concluir o passo 6 — o relatório e o atalho para a fila. */
  report?: ApplyImportData;
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
  acknowledgeHeaderDiff: () => void;
  setSelectedKeys: (keys: string[]) => void;
  toggleKey: (key: string) => void;
  setNotes: (notes: string) => void;
  setProfileIdentity: (code: string, name: string) => void;
  setReport: (report: ApplyImportData | undefined) => void;
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
  headerDiffAcknowledged: false,
  selectedKeys: undefined as string[] | undefined,
  notes: '',
  report: undefined as ApplyImportData | undefined,
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
      headerDiffAcknowledged: false,
      selectedKeys: undefined,
      report: undefined,
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

  acknowledgeHeaderDiff: () => set({ headerDiffAcknowledged: true }),

  setSelectedKeys: (selectedKeys) => set({ selectedKeys }),

  toggleKey: (key) => {
    const current = get().selectedKeys ?? [];
    set({
      selectedKeys: current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key],
    });
  },

  setNotes: (notes) => set({ notes }),

  setProfileIdentity: (code, name) => {
    set((s) => ({ profile: { ...s.profile, code, name }, dirty: true }));
  },

  setReport: (report) => set({ report }),

  jumpToPlan: () => {
    const { recognizedProfile } = get();
    if (recognizedProfile === undefined) return;
    set({ profile: recognizedProfile, step: 5, dirty: true });
  },

  reset: () => set({ ...initialState, profile: emptyProfile() }),
}));
