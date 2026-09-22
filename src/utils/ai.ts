import { Student, AIServiceConfig } from '../types';
import { callAiConsultWithServer } from '../firebase';

export async function generateAIConsult({
  student,
  type,
  config,
  classCode,
}: {
  student: Student;
  type: 'evaluation' | 'feedback';
  config?: AIServiceConfig;
  classCode?: string;
}): Promise<string> {
  // 학급코드 확인 (전달받은 classCode 또는 로컬스토리지)
  const resolvedClassCode = (classCode || localStorage.getItem('teacher_class_code') || '').trim().toUpperCase();

  if (!resolvedClassCode) {
    throw new Error('AI 생성을 위해 참여 중인 학급 코드가 필요합니다.');
  }

  // SEC-4: 브라우저 직접 LLM 호출(Google/OpenAI)을 전면 배제하고,
  // Cloud Functions 보안 프록시(/api/ai/consult)를 통해서만 안전하게 호출합니다.
  // API Key는 클라이언트에서 서버로 절대 전달하지 않으며, 서버의 secret 문서에서만 안전하게 사용됩니다.
  return await callAiConsultWithServer({
    classCode: resolvedClassCode,
    type,
    student: {
      id: student.id,
      name: student.name,
      strengths: student.strengths || [],
      weaknesses: student.weaknesses || [],
      selfDescription: student.selfDescription || '',
    },
  });
}
