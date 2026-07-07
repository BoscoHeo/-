import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Helper functions for Gemini SDK compliance
function findGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

function getGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

const app = express();
const PORT = 3000;

app.disable('x-powered-by');
app.use(express.json());

// Set Security Headers Middleware for security auditor compliance
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https: wss:; frame-ancestors 'self' https://*.google.com https://*.googleusercontent.com;");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
  next();
});

// In-Memory Shared Student DB for real-time synchronization
interface TraitItem {
  trait: string;
  rating: number;
}

interface Student {
  id: string;
  name: string;
  selfDescription: string;
  strengths: TraitItem[];
  weaknesses: TraitItem[];
  evaluation: string;
  feedback: string;
  status: 'idle' | 'generating' | 'completed' | 'error';
  errorMsg?: string;
  updatedAt?: string;
}

const DEFAULT_SAMPLES: Student[] = [
  {
    id: "student-1",
    name: "김민수",
    selfDescription: "수학과 과학 시간은 너무 재미있어서 깊게 파고들지만, 가끔 발표할 때 긴장이 많이 되고 수줍습니다. 체육을 아주 좋아합니다.",
    strengths: [
      { trait: "논리력", rating: 9 },
      { trait: "성실성", rating: 8 }
    ],
    weaknesses: [
      { trait: "집중력", rating: 5 }
    ],
    evaluation: "수학적 사고력 and 분석력이 탁월하여 어려운 심화 개념 문제도 포기하지 않고 구조화하여 해결하는 끈기가 눈에 띔. 늘 수업 준비에 철저하고 차분한 자세로 집중하는 성실한 태도를 선보임. 다만 토론과 발표 시 수줍어하는 성향이 있어 긴장을 하기도 하나, 적극적 경청 노력과 친구들의 생각을 온화하게 잘 수용하는 모습을 모범적으로 보여주며 함께 탐구해 나가는 발전을 거듭하고 있음. 우수한 신체 운동 신경을 바탕으로 체육 행사나 구기 경쟁 과정에서 학급 팀워크를 북돋는 데 크게 기여함.",
    feedback: "민수야! 네가 수학 문제를 깊고 예리하게 풀어내어 친구들에게 기쁨의 해결책을 제시할 때 선생님은 참 감탄한단다. 아주 근사하고 든든한 강점이야! 한편으로 발표할 때 가슴이 쿵쾅거리고 부끄러워도 피할 생각보단 친구들 이야기에 온 마음을 열고 경청하려는 매력이 참 멋져. 조금씩 긴장을 덜고 너의 생각을 소리 내며 전달해 본다면 네 가치가 더 널리 더 밝게 퍼질 것이라 장담해. 언제나 다재다능한 민수 화이팅!",
    status: "completed"
  },
  {
    id: "student-2",
    name: "이지민",
    selfDescription: "학급 회장으로서 행사가 있으면 앞장서서 준비하고 의견도 많이 냅니다. 하지만 제 뜻대로 친구들이 안 따라주면 가끔 예민해져서 상처를 줄 때가 있어 걱정입니다.",
    strengths: [
      { trait: "책임감", rating: 10 },
      { trait: "창의성", rating: 9 }
    ],
    weaknesses: [
      { trait: "배려심", rating: 6 }
    ],
    evaluation: "학급 전반의 크고 작은 행사 기획 및 학업 촉진 과정에 항상 주도적으로 교우들과 호흡하며 능동적인 지도력을 발휘함. 문제 해결과 협력 활동에서 참신하고 개성 있는 방안들을 창의적으로 제안하며 학급 활성화에 이바지함. 간혹 모둠 활동 진행 가치관이 맞지 않을 때 조바심을 부리는 모습이 있었으나, 점차 다른 급우의 의견을 차분하게 수용하는 조화성을 배양해 가며 원만하게 의견을 조율해 냄. 풍부한 언어 능력과 문예적 이해도를 두루 겸비하여 글쓰기 등의 인문 영역 표현력에 강점을 나타냄.",
    feedback: "지민아! 언제나 학급의 등대처럼 활력 있는 의견으로 친구들을 든든히 이끌어 주고, 반의 다양한 행사에 솔선수범해 주어 정말 고맙단다. 리더의 어깨가 무거운 만큼 친구들의 조그만 소극성에 가끔 상처를 입거나 목소리가 단호해져 속상했을 텐데, 남들의 생각 차이를 '성장의 무대'로 보고 부드럽고 온화하게 품어내는 연습을 해나가니 지민이의 리더로서의 품격이 물씬 올라가는 게 보이는구나. 고마운 우리 지민이, 언제나 응원한다!",
    status: "completed"
  },
  {
    id: "student-3",
    name: "정하늘",
    selfDescription: "친구들 고민 들어주는 것을 좋아하고 항상 웃으려고 합니다. 공부는 수학 계산이 조금 느려서 끈기 있게 복습하는 편입니다.",
    strengths: [
      { trait: "배려심", rating: 9 },
      { trait: "자기주도", rating: 8 }
    ],
    weaknesses: [
      { trait: "논리력", rating: 5 }
    ],
    evaluation: "타인을 따뜻하게 존중하는 포용적 인성을 기반으로 급우의 고민에 진정 어린 귀를 열고 공감해 주는 이타성 덕에 깊은 신망을 얻음. 학습 목표를 자기주도적으로 세워 차분히 실천하며, 특히 수학 등 다소 이해에 시일이 걸리는 조건의 문제도 스스로 오답 정리를 반복하여 극복하려는 꾸준한 발전의 자세가 매우 모범적임. 매 수업 성실한 태도를 견고하게 보지하며 예술적 감성이 발달하여 생각의 흐름을 어휘와 감미로운 일러스트로 묘사하는 문예적 소질이 매력적임.",
    feedback: "하늘아! 네가 매일 보여주는 밝고 화창한 미소와 친구들을 세심히 다독이는 따뜻한 정원 같은 성품은 네 주변을 온통 행복하고 평화롭게 채워준단다. 너무 귀한 능력이란다! 공부할 때 다소 어려운 연산이나 개념에 주눅 들지 않고 조용히 자리에 앉아 묵묵히 복습 공책을 매만지는 그 성실하고 곧은 힘이야말로 하늘이를 반드시 성공하게 해 줄 가장 튼튼한 무기가 될 거야. 너를 언제나 신뢰해!",
    status: "completed"
  }
];

let sharedStudentsStore: Student[] = [...DEFAULT_SAMPLES];

// 1.1 API: Get list of shared students
app.get("/api/shared-students", (req, res) => {
  res.json(sharedStudentsStore);
});

// 1.2 API: Add or edit a single student (Also used by student response form submissions)
app.post("/api/shared-students", (req, res) => {
  const studentData = req.body;
  if (!studentData.name) {
    res.status(400).json({ error: "학생 성명이 필요합니다." });
    return;
  }
  const existingIndex = sharedStudentsStore.findIndex(s => s.id === studentData.id);
  if (existingIndex > -1) {
    sharedStudentsStore[existingIndex] = { ...sharedStudentsStore[existingIndex], ...studentData, updatedAt: new Date().toISOString() };
  } else {
    const newStudent = {
      ...studentData,
      id: studentData.id || `student-${Date.now()}`,
      status: studentData.status || 'completed',
      updatedAt: new Date().toISOString()
    };
    sharedStudentsStore.push(newStudent);
  }
  res.json({ success: true, count: sharedStudentsStore.length });
});

// 1.6 API: Generate AI feedback or evaluation report
app.post("/api/generate", async (req, res) => {
  try {
    const { student, type, config } = req.body;
    const { name, strengths, weaknesses, selfDescription } = student;
    const strengthsStr = (strengths || []).map((s: any) => `${s.trait}(${s.rating}점)`).join(", ");
    const weaknessesStr = (weaknesses || []).map((w: any) => `${w.trait}(${w.rating}점)`).join(", ");

    const feedbackTone = config?.feedbackTone || "gentle";
    const feedbackCustomInstruction = config?.feedbackCustomInstruction || "";

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
      // Counselor Feedback (학생 성장을 돕는 상담/성장 조언)
      systemInstruction = "너는 학생을 진부한 AI나 외부 멘토가 아닌, 교실에서 늘 함께 머무는 대한민국의 다정한 담임 선생님이야. 학생이 직접 작성한 자기평가 일지를 아주 성심껏 읽으며, 아이의 학교 생활을 따스하게 돌아보고 다정하게 격려의 위로 편지를 전하고 있어.";
      
      let toneGuideline = "";
      if (feedbackTone === "gentle") {
        toneGuideline = "4. 다정다감형 어조 지침: 격식 없고 깊은 온기가 느껴지는 다정한 초등학교 담임선생님의 반말 혹은 구어체(예: '좋았단다', '대견하구나', '선생님은 너의 노력에서 큰 우주를 응원하고 있어!', '언제나 곁에서 힘이 되어줄게')를 100% 사용하여 학생에게 친근하게 말을 건네도록 해줘.";
      } else if (feedbackTone === "respectful") {
        toneGuideline = "4. 존중정중형 어조 지침: 예의 바르고 배려가 섞인 정중하며 따뜻한 존댓말(예: '~했군요!', '~한 모습이 참 아름답습니다', '앞으로도 늘 응원하고 함께 성찰하겠습니다')로 학생 한 명 한 명을 인격적으로 존중하는 어조를 보여줘.";
      } else if (feedbackTone === "humorous") {
        toneGuideline = "4. 유머위트형 어조 지침: 친근하고 재치 있는 교실 안의 든든한 삼촌, 이모 혹은 절친 누나/형 같은 유쾌하고 센스 넘치는 반말 구어체(예: '우와, 이건 진짜 대박 활약이었음!', '그 와중에 걱정하는 생각은 귀엽네ㅋㅋ', '선생님이 보기엔 너 진짜 잠재력 뿜뿜하는 비밀병기야!')로 학생에게 웃음과 위트를 전하며 소통해줘.";
      } else if (feedbackTone === "poetic") {
        toneGuideline = "4. 감성서정형 어조 지침: 따뜻한 문학적 비유, 자연의 변화, 명언, 혹은 책의 한 구절 같은 감성적 울림이 있는 은유적이며 깊이 있는 어조(예: '마치 보이지 않는 곳에서 조용히 뿌리를 돋우고 마침내 싱그러운 숲을 만드는 푸른 새싹처럼', '고백하는 용기보다 소중한 자산은 없단다')로 마음에 스며드는 따뜻한 감성 서술을 사용해줘.";
      } else if (feedbackTone === "mentor") {
        toneGuideline = "4. 멘토지도형 어조 지침: 부드러운 격려에 그치지 않고, 명확한 성장 과제와 미래 비전을 주도적으로 일깨워 주는 똑부러진 멘토/코칭 반말투(예: '지금 느낀 고민은 다음 성장을 위한 완벽한 신호탄이야!', '우리는 할 수 있어. 이번에 배운 피드백을 토대로 다음에는 더 크고 견고하게 실천해 나가는 거야. 선생님도 기꺼이 너의 페이스메이커가 되어줄게!')를 유지해줘.";
      } else if (feedbackTone === "custom") {
        toneGuideline = `4. 사용자 지정 어조 지침: 사용자가 별도로 정한 다음 어조 및 요구사항을 100% 모사하여 편지를 작성해주십시오: "${feedbackCustomInstruction}"`;
      }

      // If custom instructions are provided alongside standard tones, we append them as extra rules
      if (feedbackCustomInstruction && feedbackTone !== "custom") {
        toneGuideline += `\n[매우 중요 - 특별 추가 문체 규칙 및 말투 예시]:\n${feedbackCustomInstruction}`;
      }

      prompt = `선생님이 우리 반 ${name} 학생의 자기 성찰 일지를 읽고, 교실 속에서 우리 ${name}와(과) 함께했던 순간들을 그려가며 더 힘을 실어줄 수 있는 현실적이고 진성성 있는 따뜻한 담임 선생님의 마음 편지를 작성하고 있어.
 
[학생의 자기 평가 정보]
이름: ${name}
선택한 나의 강점(장점): ${strengthsStr || "없음"}
이번에 더 노력하고 싶은 점(약점): ${weaknessesStr || "없음"}
내가 돌아본 나의 이번 학기 일지(자기평가): ${selfDescription || "없음"}
 
[편지 작성 지침 - 반드시 지킬 것]
1. 발화 주체 명확화: 편지는 오롯이 '선생님'의 시선에서 발송되어야 해. 절대 'AI 분석 결과', '진단 보고서' 같은 단어나 인공지능이 분석해 주는 느낌이 들게 하지 마. 편지의 첫 머리부터 문득 네 일지를 읽고 따뜻한 칭찬과 사랑을 전하고 싶어 말을 건내는 선생님으로 완벽하게 연출해주며 이름(${name})을 다정하게 부르며 다가가줘. (예: "${name}아, 안녕! 선생님이란다. 이번 학기에 네가 쓴 소중한 성찰 일지를 읽으면서 선생님 마음이 정말 뭉클해서 이렇게 너에게 글을 남겨.")
2. 구체적이고 현실적인 스토리텔링: 학생이 선택한 장점(${strengthsStr})과 보완하고 싶은 점(${weaknessesStr})의 명칭들을 마냥 기계적으로만 나열하지 마. 평소의 교실 상황을 실감 나게 반영해서 정성스럽게 서술해줘.
3. 발전 가능성과 따뜻한 토닥임: 보완 장벽으로 표현된 것들 역시, 아이들의 실수를 기꺼이 넓은 품으로 안아주며 앞으로 성장할 모습에 초점을 맞추어 따뜻하게 어루만져줘.
${toneGuideline}
5. 엄격한 행정단어 배제: '생활기록부', '생기부', '평가 기준', '기재 가이던스', 'AI 기반 피드백', '대시보드' 등과 같은 어색하고 딱딱한 인공적인 단어나 행정 양식은 일절 언급하지 마. 이는 친근한 나만의 성찰 교실이야.
6. 마크다운 기호(*, #, - 등)는 가독성에 방해가 되므로 절대 일절 사용하지 말고, 가독성에 맞게 자연스럽게 줄바꿈된 몇 개의 단락으로만 구성해줘. 분량은 300자에서 450자 안팎의 정성 어린 깊이로 해줘.`;
    }

    const targetService = config?.service || "built-in";
    const customKey = config?.apiKey;

    if (targetService === "custom-openai") {
      // Call Custom OpenAI API via fetch
      const openaiKey = customKey;
      if (!openaiKey) {
        res.status(400).json({ error: "OpenAI API 키가 설정되지 않았습니다." });
        return;
      }

      const modelName = config.model || "gpt-4o-mini";
      const requestPayload = {
        model: modelName,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
      };

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
      }

      const responseData = await response.json();
      const generatedText = responseData.choices?.[0]?.message?.content || "";
      res.json({ result: generatedText.trim() });

    } else {
      // Call Gemini via official SDK (built-in or custom key)
      const isCustom = targetService === "custom-gemini";
      const geminiKey = isCustom ? customKey : findGeminiApiKey();

      if (!geminiKey) {
        res.status(400).json({
          error: isCustom 
            ? "사용자정의 Gemini API 키가 입력되지 않았습니다. 설정 모달에서 입력하시거나 '기본 탑재 AI'로 전환하세요." 
            : "서버에 감지된 기본 탑재 또는 시스템 일치 Gemini API 키 환경변수가 없습니다. '설정 > Secrets' 탭에서 본인의 API 키를 올바르게 등록하고 사용해 보세요."
        });
        return;
      }

      const ai = getGeminiClient(geminiKey);
      const modelName = isCustom ? (config.model || "gemini-2.5-flash") : "gemini-2.5-flash";

      const apiResponse = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.7,
        }
      });

      const responseText = apiResponse.text || "";
      res.json({ result: responseText.trim() });
    }

  } catch (error: any) {
    console.error("AI Generation server error:", error);
    res.status(500).json({ error: error.message || "AI 생성 프로세스 진행 중 에러가 발생했습니다." });
  }
});

// Configure Vite integration or static file serving
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server started and listening on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
