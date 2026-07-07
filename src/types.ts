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
  isFeedbackSent?: boolean; // 교사가 학생에게 편지(피드백)을 발송/공개했는지 여부
  password?: string;        // 학생이 스스로 설정한 4자리 간단 비밀번호
}

export interface AIServiceConfig {
  service: 'built-in' | 'custom-gemini' | 'custom-openai';
  apiKey?: string;
  model?: string;
  feedbackTone?: 'gentle' | 'respectful' | 'humorous' | 'poetic' | 'mentor' | 'custom';
  feedbackCustomInstruction?: string;
}

export interface PresetTrait {
  name: string;
  category: '생활' | '인성' | '학습';
  description: string;
}
