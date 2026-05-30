import { Student, AIServiceConfig } from '../types';

export async function generateAIConsult({
  student,
  type,
  config
}: {
  student: Student;
  type: 'evaluation' | 'feedback';
  config: AIServiceConfig;
}): Promise<string> {
  // 1. Try backend server proxy /api/generate first
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student, type, config })
    });
    if (res.ok) {
      const data = await res.json();
      return data.result;
    }
    
    // If backend returns 404 (means running on Netlify/static hosting) and user has a custom API key
    if (res.status === 404) {
      if (config.service !== 'built-in' && config.apiKey) {
        console.warn("Express backend API endpoint not found. Falling back to direct client-side generation.");
      } else {
        throw new Error("서버 생성 실패 (404) -- Netlify 등의 정적 호스팅 환경인 경우, 우측 상단의 'AI 서비스 설정'에서 개별 API Key(Gemini 또는 OpenAI)를 입력하고 저장하셔야 학생 기기 및 외부 기기에서도 직접 안전하게 생성 기능이 작동합니다.");
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `서버 생성 실패 (${res.status})`);
    }
  } catch (error) {
    // If it is a network error or connection refused (or static hosting) and we have keys, try direct client fallback
    if (config.apiKey) {
      console.log("Server API proxy is unreachable. Initiating direct browser-to-LLM client fallback...");
    } else {
      throw error;
    }
  }

  // 2. Resilient static fallback directly in the browser (Using user custom credentials)
  const { name, strengths, weaknesses, selfDescription } = student;
  const strengthsStr = strengths.map((s) => `${s.trait}(${s.rating}점)`).join(", ");
  const weaknessesStr = weaknesses.map((w) => `${w.trait}(${w.rating}점)`).join(", ");

  let prompt = "";
  let systemInstruction = "";

  if (type === "evaluation") {
    systemInstruction = "너는 학생 지도 경력이 풍부하고 따뜻한 시각을 지닌 대한민국의 노련한 초중고 학급 담임 교사야.";
    prompt = `다음 학생의 핵심 특성을 바탕으로 학교 학교생활기록부 기재용 '행동특성 및 종합의견' 평가문을 정성껏 작성해주세요.

[학생 정보]
이름: ${name}
강점(장점): ${strengthsStr || "없음"}
약점(보완점): ${weaknessesStr || "없음"}
자기평가 내용: ${selfDescription || "없음"}

[중요 작성 규칙]
1. 모든 문장은 생활기록부 공문서 형식에 맞게 반드시 어미를 '~보임', '~씀', '~음', '~함', '~됨' 등으로 끝맺음해야 합니다. (존댓말 사용 금지)
2. 전체 문장의 길이는 공백 포함 300자 이상 400자 이하로 적절히 맞추고 하나의 단락으로 연속 작성하세요.
3. '학생은', '그는'과 같은 주어는 생략하고 서술어 중심 형태로 기재하십시오.`;
  } else {
    systemInstruction = "너는 교육심리학적 전문성과 다정한 위로 능력을 갖춘 대한민국의 따뜻한 전문 상담교사(클래스 멘토)야.";
    prompt = `다음 학생의 강점과 약점, 자기평가를 확인한 후, 학생의 자존감을 높이고 긍정적인 성장을 독려하는 '성장 맞춤형 상담 편지'를 작성해줘.

[학생 정보]
이름: ${name}
강점: ${strengthsStr || "없음"}
약점: ${weaknessesStr || "없음"}
자기평가: ${selfDescription || "없음"}

[중요 작성 규칙]
1. 격려가 가득 담긴 친근한 반말/대화체('~길 바랄게', '~고마워', '~응원할게')로 다정하게 말해줘.
2. 300자 내외로 따뜻하고 문학적으로 작성해 줘.`;
  }

  if (config.service === 'custom-openai') {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API 에러: ${text}`);
    }
    const resData = await response.json();
    return resData.choices?.[0]?.message?.content?.trim() || "";
  } else {
    // Default: Gemini Custom Direct REST fetch endpoint
    const model = config.model || "gemini-3.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemInstruction}\n\n${prompt}` }] }],
        generationConfig: { temperature: 0.7 }
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API 에러: ${text}`);
    }
    const resData = await response.json();
    return resData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  }
}
