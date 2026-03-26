import { create } from 'zustand';

export interface Acquisition {
  id: string;
  type: string;
  timestamp: string;
  path: string;
  status: 'completed' | 'failed' | 'in-progress';
  hash?: string;
}

export interface CaseState {
  caseName: string;
  casePath: string;
  caseNumber: string;
  examiner: string;
  description: string;
  createdAt: string | null;
  deviceSerial: string;
  deviceModel: string;
  acquisitions: Acquisition[];

  setCaseInfo: (info: Partial<CaseState>) => void;
  addAcquisition: (acquisition: Acquisition) => void;
  updateAcquisition: (id: string, updates: Partial<Acquisition>) => void;
  clearCase: () => void;
}

const initialState = {
  caseName: '',
  casePath: '',
  caseNumber: '',
  examiner: '',
  description: '',
  createdAt: null as string | null,
  deviceSerial: '',
  deviceModel: '',
  acquisitions: [] as Acquisition[],
};

export const useCaseStore = create<CaseState>((set) => ({
  ...initialState,

  setCaseInfo: (info) =>
    set((state) => ({
      ...state,
      ...info,
    })),

  addAcquisition: (acquisition) =>
    set((state) => ({
      acquisitions: [...state.acquisitions, acquisition],
    })),

  updateAcquisition: (id, updates) =>
    set((state) => ({
      acquisitions: state.acquisitions.map((a) =>
        a.id === id ? { ...a, ...updates } : a
      ),
    })),

  clearCase: () => set(initialState),
}));
