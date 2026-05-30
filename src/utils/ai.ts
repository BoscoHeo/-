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

학생과 친근하게 지냈던 관찰 결과를 바탕으로 기재 규정을 완벽하게 만족해야 합니다.

[학생 정보]
이름: ${name}
강점(장점): ${strengthsStr || "없음"}
약점(보완점): ${weaknessesStr || "없음"}
학생 본인의 자기평가 내용: ${selfDescription || "없음"}

[중요 작성 규칙 - 반드시 지킬 것]
1. 모든 문장은 생활기록부 공문서 형식에 맞게 반드시 어미를 '~보임', '~씀', '~음', '~함', '~됨' 등으로 정중하고 명료하게 끝맺음해야 합니다. (예: '~활동에 적극 참여함', '~이해심이 넓어 친구들에게 인기가 많음', '~지도력을 발휘함')
2. 문장은 존댓말('~수행합니다', '~것입니다')이나 친근체('~해보자', '~잘했어')를 절대 사용하지 않습니다.
3. 강점을 부각해서 약 70~80% 비중으로 심층 서술하되, 약점은 20~30% 정도로 서술하며 단순히 지적이 아니라 단점을 충분히 이겨내고 해결책을 찾는 '발전 가능성 및 극복 노력'의 관점으로 매끄럽게 포장해 주어야 합니다.
4. 구체적인 교과 태도와 다른 친구들과의 조화로운 관계, 학업 열정도 입체적으로 언급합니다.
5. 학습 태도와 관련된 사항은 가급적 문장의 초반에 기재하고, 예체능 능력이나 특기사항 등이 있다면 가장 마지막(어미부)에 자연스럽게 이어지게 마무리합니다.
6. 전체 문장의 길이는 공백 포함 300자 이상 400자 이하로 적절히 맞추고, 중간에 불필요한 줄바꿈(엔터)이나 마크다운(#, *, -, \` 등)은 절대 사용하지 말고 연속된 긴 단락 하나로 작성해 주어야 합니다.
7. '학생은' 또는 '이 학생은', '그는'과 같은 상투적인 주어는 문맥상 자연스럽게 생략하고 서술어 중심의 주격 생략 형태로 기재합니다.
8. 학생이 작성한 자기평가 내용(${selfDescription || "없음"})을 자연스럽게 분석하고 수렴하여, 본인의 성찰 성향을 좋게 반영해 줍니다.`;
  } else {
    systemInstruction = "너는 교육심리학적 전문성과 다정한 위로 능력을 갖춘 대한민국의 따뜻한 전문 상담교사(클래스 멘토)야.";
    prompt = `다음 학생의 강점과 약점, 자기평가를 확인한 후, 학생의 자존감을 높이고 긍정적인 성장을 독려하는 '성장 맞춤형 상담 편지'를 작성해줘.

[학생 정보]
이름: ${name}
강점: ${strengthsStr || "없음"}
약점: ${weaknessesStr || "없음"}
자기평가: ${selfDescription || "없음"}

[중요 작성 규칙]
1. 격려가 가득 담긴 친근하고 정겨운 대화체(반말, 예: '~하길 바랄게', '~하는 모습이 정말 멋져', '~선생님은 너의 성장을 응원해')로 은은하고 다정하게 말해줘.
2. 이름(${name})을 본문에 자연스럽게 부르되, 문장이 딱딱하지 않고 부드럽게 흐르도록 작성해야 해.
3. 강점을 진심으로 축하하고 극찬해 주며, 약점은 보완할 수 있는 긍정적인 방향의 성장 미션으로 따뜻하게 감싸 안아줘.
4. 편지의 끝부분에 아무런 문맥 없이 기계적으로 '고마워, [이름]아!' 혹은 '인사하고 끝내기'처럼 뜬금없는 감사 인사나 어색한 구절을 붙여 마무리하지 말고, 학생의 자존감을 키우는 진정성 넘치는 덕담과 따뜻한 다짐 및 응원 문장으로 세련되고 마음 깊이 마무리해 줘.
5. 중간에 마크다운 기호(*, #, \` 등)는 일체 제외하고, 가독성 좋은 줄바꿈과 넉넉하고 편안한 단락 구성으로 300자 내외로 작성해 줘.`;
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
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        generationConfig: { 
          temperature: 0.7 
        }
      })
    });
    
    if (!response.ok) {
      const text = await response.text();
      let detailedMsg = text;
      try {
        const parsed = JSON.parse(text);
        if (parsed.error?.message) {
          detailedMsg = parsed.error.message;
        } else if (parsed.error) {
          detailedMsg = typeof parsed.error === 'object' ? JSON.stringify(parsed.error) : parsed.error;
        }
      } catch (e) {
        // Not valid JSON, keep raw text
      }
      throw new Error(`Gemini API 에러: ${detailedMsg}`);
    }
    const resData = await response.json();
    return resData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  }
}
