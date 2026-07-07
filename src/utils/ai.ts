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
1. **[어미 제한] 통지표 및 생활기록부의 모든 문장은 반드시 어미가 '~함.' 또는 '~임.'으로만 끝나야 합니다.** (마침표 포함)
   - 예: '~보임', '~있음', '~기대됨', '~생각됨', '~드러남' 등 다른 어미는 일절 금지하며, 오직 **'~함.' 또는 '~임.'**으로만 완결되게 문장을 수정하여 작성하십시오.
   - 특히 **'~할 수 있음' 이나 '~수 있음'은 절대 사용하지 마십시오.** (예: '수행할 수 있음' -> '수행함.' 등으로 무조건 '~함.' 형태로 가다듬어 표현해야 합니다.)
2. **[줄바꿈 금지] 문장이 끝나도 절대 줄을 바꾸지(엔터) 마십시오. 온점(.) 뒤에 정확히 한 칸만 띄우고(띄어쓰기) 이어서 기록하십시오.**
3. **[영문 및 특수문자 금지] 영문 알파벳과 특수문자(예: +, -, X 등)는 절대 기재하지 마십시오.**
   - 기호 대신 반드시 '덧셈', '뺄셈', '곱셈' 등과 같이 **순수 한글**로 풀어 적어야 합니다.
   - 단, cm, kg 등과 같은 **표준 물리적 단위는 예외적으로 영문 기재가 가능**합니다.
4. 문장은 존댓말('~수행합니다', '~것입니다')이나 친근체('~해보자', '~잘했어')를 절대 사용하지 않습니다.
5. 강점을 부각해서 약 70~80% 비중으로 심층 서술하되, 약점은 20~30% 정도로 서술하며 단순히 지적이 아니라 단점을 충분히 이겨내고 해결책을 찾는 '발전 가능성 및 극복 노력'의 관점으로 매끄럽게 포장해 주어야 합니다.
6. 구체적인 교과 태도와 다른 친구들과의 조화로운 관계, 학업 열정도 입체적으로 언급합니다.
7. 학습 태도와 관련된 사항은 가급적 문장의 초반에 기재하고, 예체능 능력이나 특기사항 등이 있다면 가장 마지막(어미부)에 자연스럽게 이어지게 마무리합니다.
8. 전체 문장의 길이는 공백 포함 300자 이상 400자 이하로 적절히 맞추고, 중간에 불필요한 줄바꿈(엔터)이나 마크다운(#, *, -, \` 등)은 절대 사용하지 말고 연속된 긴 단락 하나로 작성해 주어야 합니다.
9. '학생은' 또는 '이 학생은', '그는'과 같은 상투적인 주어는 문맥상 자연스럽게 생략하고 서술어 중심의 주격 생략 형태로 기재합니다.
10. 학생이 작성한 자기평가 내용(${selfDescription || "없음"})을 자연스럽게 분석하고 수렴하여, 본인의 성찰 성향을 좋게 반영해 줍니다.`;
  } else {
    systemInstruction = "너는 학생을 진부한 AI나 외부 멘토가 아닌, 교실에서 늘 함께 머무는 대한민국의 다정한 담임 선생님이야. 학생이 직접 작성한 자기평가 일지를 아주 성심껏 읽으며, 아이의 학교 생활을 따스하게 돌아보고 다정하게 격려의 위로 편지를 전하고 있어.";
    prompt = `선생님이 우리 반 ${name} 학생의 자기 성찰 일지를 읽고, 교실 속에서 우리 ${name}와(과) 함께했던 순간들을 그려가며 더 힘을 실어줄 수 있는 현실적이고 진정성 있는 따뜻한 담임 선생님의 마음 편지를 작성하고 있어.

[학생의 자기 평가 정보]
이름: ${name}
선택한 나의 장점(장점): ${strengthsStr || "없음"}
이번에 더 노력하고 싶은 점(약점): ${weaknessesStr || "없음"}
내가 돌아본 나의 이번 학기 일지(자기평가): ${selfDescription || "없음"}

[편지 작성 지침 - 반드시 지킬 것]
1. 발화 주체 명확화: 편지는 오롯이 '선생님'의 시선에서 발송되어야 해. 절대 'AI 분석 결과', '진단 보고서' 같은 단어나 인공지능이 분석해 주는 느낌이 들게 하지 마. 편지의 첫 머리부터 문득 네 일지를 읽고 따뜻한 칭찬과 사랑을 전하고 싶어 말을 건내는 선생님으로 완벽하게 연출해주며 이름(${name})을 다정하게 부르며 다가가줘. (예: "${name}아, 안녕! 선생님이란다. 이번 학기에 네가 쓴 소중한 성찰 일지를 읽으면서 선생님 마음이 정말 뭉클해서 이렇게 너에게 글을 남겨.")
2. 구체적이고 현실적인 스토리텔링: 학생이 선택한 장점(${strengthsStr})과 보완하고 싶은 점(${weaknessesStr})의 명칭들을 마냥 기계적으로만 나열하지 마. 예를 들어 '너는 협동과 배려가 뛰어나구나'보다는, '평소에 친구가 어려워할 때 서슴없이 책상을 다가서 도와주던 모습, 따뜻한 눈빛으로 경청해주던 그 이쁜 협동과 의사소통의 마음이 언제나 교실을 온기로 빚어낸단다'처럼 실제 학교 현장의 리얼하고 선명한 일기 같은 상황으로 정성스럽게 살려서 녹여내줘.
3. 발전 가능성과 따뜻한 토닥임: 보완 장벽으로 표현된 것들 역시, 꾸물거리거나 실수를 염려했던 마음 등 아이들의 심리에 밀착해서 포근하게 감싸 안는 방식으로 서술해줘. 그것을 솔직하게 고백할 줄 아는 ${name}의 큰 그릇에 대한 진짜 칭찬과 함께 다음에는 선생님과 조금씩 채워가보자는 애정 어린 한마디가 되게 해줘.
4. 다정하고 부드러운 어조: 격식 없고 깊은 온기가 느껴지는 문체와 존중을 담은 반말 혹 구어체(예: '좋았단다', '대견하구나', '~하길 늘 곁에서 선생님이 응원하고 기도할게!')를 유지해줘.
5. 엄격한 행정단어 배제: '생활기록부', '생기부', '평가 기준', '기재 가이던스', 'AI 기반 피드백', '대시보드' 등과 같은 어색하고 딱딱한 인공적인 단어나 행정 양식은 일절 언급하지 마. 이는 친근한 나만의 성찰 교실이야.
6. 마크다운 기호(*, #, - 등)는 가독성에 방해가 되므로 절대 일절 사용하지 말고, 가독성에 맞게 자연스럽게 줄바꿈된 몇 개의 단락으로만 구성해줘. 분량은 300자에서 450자 안팎의 정성 어린 깊이로 해줘.`;
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
