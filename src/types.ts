export interface TraitItem {
  trait: string;
  rating: number; // 1 to 10
}

export interface Student {
  id: string;
  name: string;
  selfDescription: string;
  strengths: TraitItem[];
  weaknesses: TraitItem[];
  evaluation: string; // 생활기록부용 행동특성 종합의견 (~임, ~함 체)
  feedback: string;   // 학생 및 학부모 상담용 따뜻한 피드백
  status: 'idle' | 'generating' | 'completed' | 'error';
  errorMsg?: string;
  updatedAt?: string;
}

export interface AIServiceConfig {
  service: 'built-in' | 'custom-gemini' | 'custom-openai';
  apiKey?: string;
  model?: string;
}

export interface PresetTrait {
  name: string;
  category: '학업/태도' | '공동체/인성' | '개성/역량';
  description: string;
}
